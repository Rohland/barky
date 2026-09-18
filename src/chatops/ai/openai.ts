import axios from "axios";
import { AiConfig } from "../config.js";
import { AiUnavailableError } from "./types.js";
import { log } from "../../models/logger.js";

// a reasoning model spends this budget thinking before a single character of the answer is
// emitted, and the cost optimised tier barky prefers is exactly where those live. Too small a cap
// comes back as an empty reply rather than an error, so it is deliberately generous - it is a cap
// and not a reservation, so a reply that needs eighty tokens is only ever charged for eighty.
const MaxOutputTokens = 4000;

export interface ICompletionRequest {
    model: string;
    instructions: string;
    input: string;
    schema: any;
}

export class AiRefusedError extends AiUnavailableError {
    constructor(public readonly refusal: string) {
        super("ai service refused the request");
        this.name = "AiRefusedError";
    }
}

export class EmptyAiResponseError extends Error {
    constructor(public readonly finishReason?: string) {
        super(EmptyAiResponseError.describe(finishReason));
        this.name = "EmptyAiResponseError";
    }

    /*
     The reply was cut off before it was finished rather than never started - the model used the
     whole output budget, which for a reasoning model can happen before it answers at all.
     */
    public get budgetExhausted(): boolean {
        return this.finishReason === "length";
    }

    private static describe(finishReason?: string): string {
        return finishReason === "length"
            ? `ai service returned no content - the model used all ${ MaxOutputTokens } output tokens before answering`
            : "ai service returned no content";
    }
}

/*
 Calls OpenAI's chat completions endpoint with a strict JSON schema, so the reply is a single
 structured object rather than free text. Chat completions is used in preference to the newer
 responses API because the base url is configurable, which lets this point at Azure, a gateway or
 any other OpenAI compatible endpoint.
 */
export class OpenAiClient {

    constructor(private readonly config: AiConfig) {
    }

    public async listModels(): Promise<any[]> {
        try {
            return await this.requestModels();
        } catch (err) {
            const safe = describeHttpError(err);
            log(`chatops: could not list ai models: ${ safe.message }`);
            throw new AiUnavailableError("could not list the available ai models", { cause: safe });
        }
    }

    public async complete(request: ICompletionRequest): Promise<any> {
        const content = await this.request({
            model: request.model,
            // temperature is deliberately not sent - current models only accept their default and
            // reject anything else outright. The strict schema is what constrains the reply.
            max_completion_tokens: MaxOutputTokens,
            messages: [
                { role: "system", content: request.instructions },
                { role: "user", content: request.input }
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "barky_intent",
                    strict: true,
                    schema: request.schema
                }
            }
        });
        return OpenAiClient.parse(content);
    }

    private static parse(content: string): any {
        try {
            return JSON.parse(content);
        } catch (err) {
            throw new AiUnavailableError("ai service returned a response that could not be parsed", { cause: err });
        }
    }

    private async request(body: any): Promise<string> {
        let lastError: any;
        // one retry only - someone is waiting on a reply in slack
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                return await this.tryRequest(body);
            } catch (err) {
                if (err instanceof AiUnavailableError) {
                    throw err;
                }
                lastError = err;
                if (!OpenAiClient.isWorthRetrying(err)) {
                    break;
                }
            }
        }
        const safe = describeHttpError(lastError);
        log(`chatops: ai service call failed: ${ safe.message }`);
        throw new AiUnavailableError("ai service is unavailable", { cause: safe });
    }

    private async tryRequest(body: any): Promise<string> {
        const result = await axios.request({
            method: "post",
            url: `${ this.config.url }/chat/completions`,
            timeout: this.config.timeoutMs,
            headers: {
                "Authorization": `Bearer ${ this.config.apiKey }`,
                "Content-type": "application/json"
            },
            data: JSON.stringify(body)
        });
        const choice = result.data?.choices?.[0];
        const message = choice?.message;
        if (message?.refusal) {
            throw new AiRefusedError(message.refusal);
        }
        if (!message?.content) {
            throw new EmptyAiResponseError(choice?.finish_reason);
        }
        return message.content;
    }

    private async requestModels(): Promise<any[]> {
        const result = await axios.request({
            method: "get",
            url: `${ this.config.url }/models`,
            timeout: this.config.timeoutMs,
            headers: {
                "Authorization": `Bearer ${ this.config.apiKey }`
            }
        });
        return result.data?.data ?? [];
    }

    private static isWorthRetrying(err: any): boolean {
        if (err instanceof EmptyAiResponseError) {
            // a reply the output budget cut short will be cut short again - only a larger cap
            // fixes it, so the retry is spent to no purpose and the log says exactly that
            return !err.budgetExhausted;
        }
        const status = err?.response?.status;
        if (!status) {
            // a timeout or connection level failure
            return true;
        }
        return status === 429 || status >= 500;
    }
}

/*
 An axios error carries the full request config, including the Authorization header holding the api
 key, and barky's logger inspects whatever it is handed. Only ever describe the safe parts, and
 never keep the original as a cause - a caller logging the error would print the key.
 */
function describeHttpError(err: any): Error {
    const status = err?.response?.status;
    const apiError = err?.response?.data?.error;
    const parts = [
        status ? `status ${ status }` : null,
        apiError?.type,
        apiError?.code,
        apiError?.message ?? err?.code ?? err?.message
    ].filter(x => !!x);
    return new Error(parts.join(": ") || "unknown error");
}

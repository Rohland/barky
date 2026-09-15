import axios from "axios";
import { AiConfig } from "../config.js";
import { AiUnavailableError } from "./types.js";
import { log } from "../../models/logger.js";

const MaxOutputTokens = 400;

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
    constructor() {
        super("ai service returned no content");
        this.name = "EmptyAiResponseError";
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
        const message = result.data?.choices?.[0]?.message;
        if (message?.refusal) {
            throw new AiRefusedError(message.refusal);
        }
        if (!message?.content) {
            throw new EmptyAiResponseError();
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

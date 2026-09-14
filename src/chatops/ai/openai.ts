import axios from "axios";
import { AiConfig } from "../config.js";
import { AiUnavailableError } from "./types.js";
import { log } from "../../models/logger.js";

const MaxOutputTokens = 400;

/*
 Calls OpenAI's chat completions endpoint with a strict JSON schema, so the reply is a single
 structured object rather than free text. Chat completions is used in preference to the newer
 responses API because the base url is configurable, which lets this point at Azure, a gateway or
 any other OpenAI compatible endpoint.
 */
export class OpenAiClient {

    constructor(private readonly config: AiConfig) {
    }

    public async complete(
        instructions: string,
        input: string,
        schema: any): Promise<any> {
        const body = {
            model: this.config.model,
            temperature: 0,
            max_completion_tokens: MaxOutputTokens,
            messages: [
                { role: "system", content: instructions },
                { role: "user", content: input }
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "barky_intent",
                    strict: true,
                    schema
                }
            }
        };
        const content = await this.request(body);
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
                const result = await axios.request({
                    method: "post",
                    url: `${ this.config.baseUrl }/chat/completions`,
                    timeout: this.config.timeoutMs,
                    headers: {
                        "Authorization": `Bearer ${ this.config.apiKey }`,
                        "Content-type": "application/json"
                    },
                    data: JSON.stringify(body)
                });
                const message = result.data?.choices?.[0]?.message;
                if (message?.refusal) {
                    throw new AiUnavailableError(`ai service refused the request: ${ message.refusal }`);
                }
                if (!message?.content) {
                    throw new Error("ai service returned no content");
                }
                return message.content;
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
        log(`chatops: ai service call failed: ${ lastError }`, lastError);
        throw new AiUnavailableError("ai service is unavailable", { cause: lastError });
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

import axios from "axios";
import mockConsole from "jest-mock-console";
import { OpenAiClient } from "./openai.js";
import { AiConfig } from "../config.js";
import { AiUnavailableError } from "./types.js";

describe("OpenAiClient", () => {

    let restoreConsole;

    beforeEach(() => {
        restoreConsole = mockConsole();
        process.env["test-openai-key"] = "sk-test";
    });

    afterEach(() => {
        restoreConsole();
        delete process.env["test-openai-key"];
    });

    function getSut(overrides: any = {}) {
        return new OpenAiClient(new AiConfig({ "api-key": "test-openai-key", ...overrides }));
    }

    function mockContent(content: string) {
        return jest.spyOn(axios, "request").mockResolvedValue({
            data: { choices: [{ message: { content } }] }
        } as any);
    }

    function errorWithStatus(status: number) {
        const err: any = new Error(`request failed with ${ status }`);
        err.response = { status };
        return err;
    }

    describe("complete", () => {
        it("should send a strict json schema request and parse the reply", async () => {
            // arrange
            const spy = mockContent('{"action":"mute","numbers":[1]}');
            const sut = getSut();

            // act
            const result = await sut.complete("do the thing", "the message", { type: "object" });

            // assert
            const request = spy.mock.calls[0][0];
            const body = JSON.parse(request.data as string);
            expect(request.url).toEqual("https://api.openai.com/v1/chat/completions");
            expect(request.headers.Authorization).toEqual("Bearer sk-test");
            expect(body.model).toEqual("gpt-4o-mini");
            expect(body.temperature).toEqual(0);
            expect(body.response_format.type).toEqual("json_schema");
            expect(body.response_format.json_schema.strict).toEqual(true);
            expect(body.messages[0]).toEqual({ role: "system", content: "do the thing" });
            expect(body.messages[1]).toEqual({ role: "user", content: "the message" });
            expect(result).toEqual({ action: "mute", numbers: [1] });
        });
        describe("with a configured base url", () => {
            it("should call that instead, so a gateway or azure can be used", async () => {
                const spy = mockContent("{}");
                const sut = getSut({ "base-url": "https://gateway.acme.com/v1/" });
                await sut.complete("a", "b", {});
                expect(spy.mock.calls[0][0].url).toEqual("https://gateway.acme.com/v1/chat/completions");
            });
        });
        describe("when the model refuses", () => {
            it("should report the service as unavailable", async () => {
                // arrange
                jest.spyOn(axios, "request").mockResolvedValue({
                    data: { choices: [{ message: { refusal: "no" } }] }
                } as any);
                const sut = getSut();

                // act & assert
                await expect(sut.complete("a", "b", {})).rejects.toBeInstanceOf(AiUnavailableError);
                expect(axios.request).toHaveBeenCalledTimes(1);
            });
        });
        describe("when the reply is not valid json", () => {
            it("should report the service as unavailable", async () => {
                mockContent("not json at all");
                await expect(getSut().complete("a", "b", {})).rejects.toBeInstanceOf(AiUnavailableError);
            });
        });
        describe("when the call times out", () => {
            it("should retry once and then give up", async () => {
                // arrange
                jest.spyOn(axios, "request").mockRejectedValue(new Error("timeout of 10000ms exceeded"));
                const sut = getSut();

                // act & assert
                await expect(sut.complete("a", "b", {})).rejects.toBeInstanceOf(AiUnavailableError);
                expect(axios.request).toHaveBeenCalledTimes(2);
            });
        });
        describe.each([[429], [500], [503]])("when the service returns %s", (status) => {
            it("should retry once", async () => {
                jest.spyOn(axios, "request").mockRejectedValue(errorWithStatus(status));
                await expect(getSut().complete("a", "b", {})).rejects.toBeInstanceOf(AiUnavailableError);
                expect(axios.request).toHaveBeenCalledTimes(2);
            });
        });
        describe.each([[400], [401], [403]])("when the service returns %s", (status) => {
            it("should not retry, as it will not succeed", async () => {
                jest.spyOn(axios, "request").mockRejectedValue(errorWithStatus(status));
                await expect(getSut().complete("a", "b", {})).rejects.toBeInstanceOf(AiUnavailableError);
                expect(axios.request).toHaveBeenCalledTimes(1);
            });
        });
        describe("when the first attempt fails and the second succeeds", () => {
            it("should return the result", async () => {
                // arrange
                jest.spyOn(axios, "request")
                    .mockRejectedValueOnce(errorWithStatus(500))
                    .mockResolvedValueOnce({ data: { choices: [{ message: { content: '{"ok":true}' } }] } } as any);

                // act
                const result = await getSut().complete("a", "b", {});

                // assert
                expect(result).toEqual({ ok: true });
            });
        });
    });
});

import axios from "axios";
import mockConsole from "jest-mock-console";
import { OpenAiClient } from "./openai.js";
import { AiConfig } from "../config.js";
import { AiUnavailableError } from "./types.js";
import { initLogger } from "../../models/logger.js";

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
            const result = await sut.complete({ model: "m1", instructions: "do the thing", input: "the message", schema: { type: "object" } });

            // assert
            const request = spy.mock.calls[0][0];
            const body = JSON.parse(request.data as string);
            expect(request.url).toEqual("https://api.openai.com/v1/chat/completions");
            expect(request.headers.Authorization).toEqual("Bearer sk-test");
            expect(body.model).toEqual("m1");
            // temperature is rejected outright by current models, so it must not be sent
            expect(body.temperature).toBeUndefined();
            expect(body.response_format.type).toEqual("json_schema");
            expect(body.response_format.json_schema.strict).toEqual(true);
            expect(body.messages[0]).toEqual({ role: "system", content: "do the thing" });
            expect(body.messages[1]).toEqual({ role: "user", content: "the message" });
            expect(result).toEqual({ action: "mute", numbers: [1] });
        });
        describe("with a configured url", () => {
            it("should call that instead, so a gateway or azure can be used", async () => {
                const spy = mockContent("{}");
                const sut = getSut({ url: "https://gateway.acme.com/v1/" });
                await sut.complete({ model: "m1", instructions: "a", input: "b", schema: {} });
                expect(spy.mock.calls[0][0].url).toEqual("https://gateway.acme.com/v1/chat/completions");
            });
        });
        describe("with a different model", () => {
            it("should use the one it is given", async () => {
                const spy = mockContent("{}");
                await getSut().complete({ model: "some-other-model", instructions: "a", input: "b", schema: {} });
                expect(JSON.parse(spy.mock.calls[0][0].data as string).model).toEqual("some-other-model");
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
                await expect(sut.complete({ model: "m1", instructions: "a", input: "b", schema: {} })).rejects.toBeInstanceOf(AiUnavailableError);
                expect(axios.request).toHaveBeenCalledTimes(1);
            });
        });
        describe("when the reply is not valid json", () => {
            it("should report the service as unavailable", async () => {
                mockContent("not json at all");
                await expect(getSut().complete({ model: "m1", instructions: "a", input: "b", schema: {} })).rejects.toBeInstanceOf(AiUnavailableError);
            });
        });
        describe("when the model spends the whole output budget before answering", () => {
            it("should not spend the retry on a call that cannot succeed", async () => {
                // arrange - a reasoning model charges its thinking to the same budget, so an
                // answer can be cut off before a single character of it is emitted
                jest.spyOn(axios, "request").mockResolvedValue({
                    data: { choices: [{ finish_reason: "length", message: { content: "" } }] }
                } as any);

                // act & assert
                await expect(getSut().complete({ model: "m1", instructions: "a", input: "b", schema: {} }))
                    .rejects.toBeInstanceOf(AiUnavailableError);
                expect(axios.request).toHaveBeenCalledTimes(1);
            });
            it("should say so, rather than reporting an unexplained outage", async () => {
                // arrange
                initLogger({ debug: true });
                jest.spyOn(axios, "request").mockResolvedValue({
                    data: { choices: [{ finish_reason: "length", message: { content: "" } }] }
                } as any);

                // act
                await expect(getSut().complete({ model: "m1", instructions: "a", input: "b", schema: {} }))
                    .rejects.toBeInstanceOf(AiUnavailableError);

                // assert
                const logged = (console.log as any).mock.calls.map(args => args.map(a => String(a)).join(" ")).join("\n");
                expect(logged).toContain("output tokens before answering");
                initLogger({ debug: false });
            });
        });
        describe("when the reply is empty for some other reason", () => {
            it("should retry once, since it may well have been a blip", async () => {
                // arrange
                jest.spyOn(axios, "request").mockResolvedValue({
                    data: { choices: [{ finish_reason: "stop", message: { content: "" } }] }
                } as any);

                // act & assert
                await expect(getSut().complete({ model: "m1", instructions: "a", input: "b", schema: {} }))
                    .rejects.toBeInstanceOf(AiUnavailableError);
                expect(axios.request).toHaveBeenCalledTimes(2);
            });
        });
        describe("when the call times out", () => {
            it("should retry once and then give up", async () => {
                // arrange
                jest.spyOn(axios, "request").mockRejectedValue(new Error("timeout of 10000ms exceeded"));
                const sut = getSut();

                // act & assert
                await expect(sut.complete({ model: "m1", instructions: "a", input: "b", schema: {} })).rejects.toBeInstanceOf(AiUnavailableError);
                expect(axios.request).toHaveBeenCalledTimes(2);
            });
        });
        describe.each([[429], [500], [503]])("when the service returns %s", (status) => {
            it("should retry once", async () => {
                jest.spyOn(axios, "request").mockRejectedValue(errorWithStatus(status));
                await expect(getSut().complete({ model: "m1", instructions: "a", input: "b", schema: {} })).rejects.toBeInstanceOf(AiUnavailableError);
                expect(axios.request).toHaveBeenCalledTimes(2);
            });
        });
        describe.each([[400], [401], [403]])("when the service returns %s", (status) => {
            it("should not retry, as it will not succeed", async () => {
                jest.spyOn(axios, "request").mockRejectedValue(errorWithStatus(status));
                await expect(getSut().complete({ model: "m1", instructions: "a", input: "b", schema: {} })).rejects.toBeInstanceOf(AiUnavailableError);
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
                const result = await getSut().complete({ model: "m1", instructions: "a", input: "b", schema: {} });

                // assert
                expect(result).toEqual({ ok: true });
            });
        });
    });
    describe("errors it reports", () => {
        beforeEach(() => {
            // the logger is a no-op unless debug is on, and debug is exactly when a leaked key
            // would be written out - so these assertions have to run with it enabled
            initLogger({ debug: true });
        });

        afterEach(() => {
            initLogger({ debug: false });
        });

        function axiosLikeError(status: number) {
            const err: any = new Error("Request failed");
            err.config = {
                url: "https://api.openai.com/v1/chat/completions",
                headers: { Authorization: "Bearer sk-SUPERSECRET-KEY" }
            };
            err.response = { status, data: { error: { message: "nope", type: "invalid_request_error" } } };
            return err;
        }

        function everythingLogged() {
            return (console.log as any).mock.calls.map(args => args.map(a => String(a)).join(" ")).join("\n");
        }

        it("should never put the api key in the log", async () => {
            // arrange - an axios error carries the request config, including the auth header, and
            // barky's logger inspects whatever it is handed
            jest.spyOn(axios, "request").mockRejectedValue(axiosLikeError(400));

            // act
            await expect(getSut().complete({ model: "m", instructions: "a", input: "b", schema: {} })).rejects.toBeInstanceOf(AiUnavailableError);

            // assert
            expect(everythingLogged()).not.toContain("sk-SUPERSECRET");
            expect(everythingLogged()).not.toContain("Authorization");
        });
        it("should not keep the raw error as a cause a caller might log", async () => {
            // arrange
            jest.spyOn(axios, "request").mockRejectedValue(axiosLikeError(400));

            // act
            let caught: any = null;
            try {
                await getSut().complete({ model: "m", instructions: "a", input: "b", schema: {} });
            } catch (err) {
                caught = err;
            }

            // assert
            const inspected = (await import("util")).inspect(caught, { depth: 10 });
            expect(inspected).not.toContain("sk-SUPERSECRET");
            expect(inspected).not.toContain("Authorization");
        });
        it("should still say enough to diagnose the failure", async () => {
            jest.spyOn(axios, "request").mockRejectedValue(axiosLikeError(400));
            await expect(getSut().complete({ model: "m", instructions: "a", input: "b", schema: {} })).rejects.toBeInstanceOf(AiUnavailableError);
            const logged = everythingLogged();
            expect(logged).toContain("status 400");
            expect(logged).toContain("invalid_request_error");
        });
        describe("when listing models fails", () => {
            it("should also keep the key out of the log", async () => {
                jest.spyOn(axios, "request").mockRejectedValue(axiosLikeError(401));
                await expect(getSut().listModels()).rejects.toBeInstanceOf(AiUnavailableError);
                expect(everythingLogged()).not.toContain("sk-SUPERSECRET");
            });
        });
    });

    describe("listModels", () => {
        it("should return the models the key has access to", async () => {
            // arrange
            const spy = jest.spyOn(axios, "request").mockResolvedValue({
                data: { object: "list", data: [{ id: "a" }, { id: "b" }] }
            } as any);
            const sut = getSut();

            // act
            const result = await sut.listModels();

            // assert
            expect(spy.mock.calls[0][0].url).toEqual("https://api.openai.com/v1/models");
            expect(spy.mock.calls[0][0].method).toEqual("get");
            expect(result.map(x => x.id)).toEqual(["a", "b"]);
        });
        describe("when the call fails", () => {
            it("should report the service as unavailable", async () => {
                jest.spyOn(axios, "request").mockRejectedValue(new Error("boom"));
                await expect(getSut().listModels()).rejects.toBeInstanceOf(AiUnavailableError);
            });
        });
    });
});

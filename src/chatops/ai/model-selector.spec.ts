import mockConsole from "jest-mock-console";
import { ModelSelector, selectModel } from "./model-selector.js";
import { AiConfig } from "../config.js";
import { AiUnavailableError } from "./types.js";
import { OpenAiClient } from "./openai.js";

describe("model selection", () => {

    let restoreConsole;

    beforeEach(() => {
        restoreConsole = mockConsole();
        process.env["test-key"] = "sk-test";
    });

    afterEach(() => {
        restoreConsole();
        delete process.env["test-key"];
    });

    function model(id: string, created: number, extra: any = {}) {
        return { id, created, ...extra };
    }

    describe("selectModel", () => {
        it("should prefer the newest cost optimised chat model", async () => {
            // arrange - a lineup spanning tiers and generations
            const models = [
                model("gpt-5.6-sol", 300),
                model("gpt-5.6-luna", 250),
                model("gpt-5-mini", 100),
                model("gpt-6-astra", 400)
            ];

            // act & assert
            expect(selectModel(models)).toEqual("gpt-5.6-luna");
        });
        describe("when no cost optimised model is offered", () => {
            it("should fall back to the newest chat model", async () => {
                const models = [model("gpt-6-astra", 400), model("gpt-5.6-sol", 300)];
                expect(selectModel(models)).toEqual("gpt-6-astra");
            });
        });
        describe("models that are not for chat", () => {
            it.each([
                ["text-embedding-3-large"],
                ["tts-1-hd"],
                ["whisper-1"],
                ["dall-e-3"],
                ["omni-moderation-latest"],
                ["gpt-4o-realtime"],
                ["gpt-4o-transcribe"],
                ["sora-2"],
                ["gpt-3.5-turbo-instruct"],
                ["computer-use-preview"],
                ["codex-mini"]
            ])("should not pick %s", async (id) => {
                // arrange - only a chat model and the excluded one, the chat model must win
                const models = [model(id, 900), model("gpt-5.6-luna", 100)];

                // act & assert
                expect(selectModel(models)).toEqual("gpt-5.6-luna");
            });
        });
        describe("a model announced for shutdown", () => {
            it("should be skipped, so deprecations look after themselves", async () => {
                const models = [
                    model("gpt-5.6-luna", 900, { shutdown_date: "2026-12-01" }),
                    model("gpt-5-mini", 100)
                ];
                expect(selectModel(models)).toEqual("gpt-5-mini");
            });
        });
        describe("pinned snapshots", () => {
            it.each([
                ["gpt-5.6-luna-2026-05-14"],
                ["gpt-5-mini-20260514"]
            ])("should prefer the moving alias over %s", async (id) => {
                const models = [model(id, 900), model("gpt-5.6-luna", 100)];
                expect(selectModel(models)).toEqual("gpt-5.6-luna");
            });
        });
        describe("fine tuned models", () => {
            it("should be ignored", async () => {
                const models = [
                    model("ft:gpt-5.6-luna:acme::abc123", 900),
                    model("gpt-5.6-luna", 100)
                ];
                expect(selectModel(models)).toEqual("gpt-5.6-luna");
            });
        });
        describe("when two models were created at the same moment", () => {
            it("should choose deterministically", async () => {
                const models = [model("b-mini", 100), model("a-mini", 100)];
                expect(selectModel(models)).toEqual("a-mini");
                expect(selectModel([...models].reverse())).toEqual("a-mini");
            });
        });
        describe("when nothing suitable is on offer", () => {
            it.each([
                [[]],
                [null],
                [[{ id: "text-embedding-3-small", created: 1 }]]
            ])("should return nothing for %s", async (models) => {
                expect(selectModel(models as any)).toBeNull();
            });
        });
        describe("when a model has no created timestamp", () => {
            it("should still be usable", async () => {
                expect(selectModel([{ id: "gpt-5.6-luna" }])).toEqual("gpt-5.6-luna");
            });
        });
    });

    describe("ModelSelector", () => {
        function getSut(models: any[], configured: string = null) {
            const calls = { count: 0 };
            const client = {
                listModels: async () => {
                    calls.count++;
                    if (!models) {
                        throw new AiUnavailableError("down");
                    }
                    return models;
                }
            } as unknown as OpenAiClient;
            const config = new AiConfig({ "api-key": "test-key", model: configured });
            return { sut: new ModelSelector(config, client), calls };
        }

        it("should discover the model and remember it", async () => {
            // arrange
            const { sut, calls } = getSut([{ id: "gpt-5.6-luna", created: 1 }]);

            // act
            expect(await sut.resolve()).toEqual("gpt-5.6-luna");
            expect(await sut.resolve()).toEqual("gpt-5.6-luna");

            // assert - discovery happens once for the life of the process
            expect(calls.count).toEqual(1);
        });
        describe("when a model is configured", () => {
            it("should use it without asking the api", async () => {
                const { sut, calls } = getSut([{ id: "gpt-5.6-luna", created: 1 }], "gpt-5.6-terra");
                expect(await sut.resolve()).toEqual("gpt-5.6-terra");
                expect(calls.count).toEqual(0);
            });
        });
        describe("when discovery fails", () => {
            it("should not cache the failure, so a later message tries again", async () => {
                // arrange
                const { sut, calls } = getSut(null);

                // act
                await expect(sut.resolve()).rejects.toBeInstanceOf(AiUnavailableError);
                await expect(sut.resolve()).rejects.toBeInstanceOf(AiUnavailableError);

                // assert
                expect(calls.count).toEqual(2);
                expect(sut.resolved).toBeUndefined();
            });
        });
        describe("when the account has nothing suitable", () => {
            it("should report the service as unavailable", async () => {
                const { sut } = getSut([{ id: "text-embedding-3-small", created: 1 }]);
                await expect(sut.resolve()).rejects.toBeInstanceOf(AiUnavailableError);
            });
        });
    });
});

import { emitResults, prepareResults } from "./result-emitter";
import mockConsole from "jest-mock-console";
import { SkippedResult } from "./models/result";
import { getTestResult } from "./models/result.spec";

describe("result-emitter", () => {
    let _restoreConsole;
    beforeEach(() => _restoreConsole = mockConsole());
    afterEach(() => _restoreConsole());

    describe("with no results", () => {
        it("should return blank", () => {
            const result = prepareResults([]);
            expect(result).toEqual("");
        });
    });
    describe("with one result", () => {
        it("should return the error", async () => {
            // arrange
            const errors = ["www.codeo.co.za"];

            // act
            const result = prepareResults(errors);

            // assert
            expect(result).toEqual(errors[0]);
        });
    });
    describe("with multiple results", () => {
        describe("if shorter than 100 chars", () => {
            it("should comma separate them", async () => {
                // arrange
                const errors = ["www.codeo.co.za", "www2.codeo.co.za", "ww3.codeo.co.za"];

                // act
                const result = prepareResults(errors);

                // assert
                expect(result).toEqual(errors.join(", "));
            });
        });
        describe("if longer than 100 chars", () => {
            it("should include as many as possible and summarise the rest", async () => {
                const count = 8;
                const errors = Array.from(Array(count).keys()).map(i => `www${i}.codeo.co.za`);

                // act
                const result = prepareResults(errors);

                // assert
                expect(result).toEqual(errors.slice(0, 5).join(", ") + " & 3 others");
                expect(result.length).toBeLessThanOrEqual(100);
            });
            describe("with only one more", () => {
                it("should be singular", async () => {
                    const count = 6;
                    const errors = Array.from(Array(count).keys()).map(i => `www${i}.codeo.co.za`);

                    // act
                    const result = prepareResults(errors);

                    // assert
                    expect(result).toEqual(errors.slice(0, 5).join(", ") + " & 1 other");
                    expect(result.length).toBeLessThanOrEqual(100);
                });
            });
        });
    });
    describe("with skipped result", () => {
        it("should not emit it", async () => {
            // arrange
            const result = new SkippedResult(new Date(), "test", "test", "test", null);

            // act
            emitResults([result]);

            // assert
            expect(console.log).not.toHaveBeenCalled();
        });
    });
    describe("emitResults", () => {
        it("should toString all items submitted on new line", () => {
           // arrange
            const item = {
                toString: jest.fn().mockReturnValueOnce("test")
            };
            const items = [item];

            // act
            // @ts-ignore
            emitResults(items);

            // assert
            expect(item.toString).toHaveBeenCalledTimes(1);
            expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^test\|/));
        });
        describe.each([
            ["", ""],
            ["my-config", "my-config"],
            ["my-config.yaml", "my-config"],
            ["./my-config.yaml", "my-config"],
            ["../my-config.yaml", "my-config"],
            ["/etc/barky/my-config.yaml", "my-config"],
            ["/etc/barky/my-config.1.yaml", "my-config.1"],
        ])(`when config is %s`, (config, expected) => {
            it("should include the main process argument as a name", async () => {
                // arrange
                const item = {
                    toString: jest.fn().mockReturnValueOnce("")
                };
                const items = [item];
                process.argv[3] = config;

                // act
                // @ts-ignore
                emitResults(items);

                // assert
                expect(item.toString).toHaveBeenCalledTimes(1);
                const regex = new RegExp("\\|" + expected + "$", "i");
                expect(console.log).toHaveBeenCalledWith(expect.stringMatching(regex));
            });

        });
        describe("when quiet enabled", () => {
            it("should not emit success", async () => {
                // arrange
                const item = {
                    success: true,
                    app: {
                        quiet: true,
                    },
                    toString: jest.fn().mockReturnValueOnce("test")
                };
                const items = [item];

                // act
                // @ts-ignore
                emitResults(items);

                // assert
                expect(item.toString).toHaveBeenCalledTimes(0);
                expect(console.log).not.toHaveBeenCalledWith("test");
            });
            it("should still emit failures", async () => {
                // arrange
                const item = {
                    success: false,
                    app: {
                        quiet: true,
                    },
                    toString: jest.fn().mockReturnValueOnce("test")
                };
                const items = [item];

                // act
                // @ts-ignore
                emitResults(items);

                // assert
                expect(item.toString).toHaveBeenCalledTimes(1);
                expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^test\|/));
            });
        });
        describe("when item strings have pipe delimiter", () => {
            it("should replace them", async () => {
                // arrange
                const item = getTestResult();
                item.resultMsg = "web|identifier|test";
                item.result = "a|b";
                const items = [item];

                // act
                // @ts-ignore
                emitResults(items);

                // assert
                expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/web\/identifier\/test/));
                expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/a\/b/));
            });
        });
        describe("when item strings have line breaks", () => {
            it("should strip them", async () => {
                // arrange
                const item = {
                    toString: jest.fn().mockReturnValueOnce("test\r\n1\n2")
                };
                const items = [item];

                // act
                // @ts-ignore
                emitResults(items);

                // assert
                expect(item.toString).toHaveBeenCalledTimes(1);
                expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^test 1 2\|/));
            });
        });
    });
});

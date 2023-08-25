import { emitResults, prepareResults } from "./result-emitter";
import mockConsole from "jest-mock-console";

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
            expect(console.log).toHaveBeenCalledWith("test");
        });
        describe("when quiet enabled", () => {
            it("should not emit", async () => {
                // arrange
                const item = {
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
                expect(console.log).toHaveBeenCalledWith("test 1 2");
            });
        });
    });
});

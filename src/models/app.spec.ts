import { AppVariant } from "./app.js";

describe("AppVariant", () => {
    describe("with variant", () => {
        describe.each([
            ["name"],
            ["url"],
            ["query"],
            ["path"],
            ["connection"],
        ])(`when app has %s`, (field) => {
            describe(`when app has ${ field }`, () => {
                it(`should transform ${ field }`, async () => {
                    // arrange
                    // act
                    const sut = new AppVariant({[field]: "Test$1"}, "1")

                    // assert
                    expect(sut[field]).toEqual("Test1");
                    expect(sut.variation).toEqual(["1"]);
                });
                describe("with array", () => {
                    it("should transform name", async () => {
                        // arrange
                        // act
                        const sut = new AppVariant({[field]: "Test$1$2"}, ["1", "2"])

                        // assert
                        expect(sut[field]).toEqual("Test12");
                        expect(sut.variation).toEqual(["1", "2"]);
                    });
                });
                describe("with null", () => {
                    it("should not transform name", async () => {
                        // arrange
                        // act
                        const sut = new AppVariant({[field]: "Test$1"}, null);

                        // assert
                        expect(sut[field]).toEqual("Test$1");
                        expect(sut.variation).toEqual([null]);
                    });
                });
            });
        });
        describe("with fields that are arrays", () => {
            describe("like alert.channels", () => {
                describe("if missing", () => {
                    it("should do nothing", async () => {
                        const config = {};
                        const sut = new AppVariant(config, "1");
                        expect(sut.alert).toBe(undefined);
                    });
                });
                describe("if empty", () => {
                    it("should return empty array", async () => {
                        const config = {
                            alert: {
                                channels: []
                            }
                        };
                        const sut = new AppVariant(config, "1");
                        expect(sut.alert.channels).toEqual([]);
                    });
                });
                describe("with values", () => {
                    it("should inject", async () => {
                        const config = {
                            alert: {
                                channels: [
                                    "my-test-$1"
                                ]
                            }
                        };
                        const sut = new AppVariant(config, "1");
                        expect(sut.alert.channels).toEqual(["my-test-1"]);
                    });
                });
            });
        });
    });
});

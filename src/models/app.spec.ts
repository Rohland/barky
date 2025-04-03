import { AppVariant } from "./app";

describe("AppVariant", () => {
    describe("with variant", () => {
        describe.each([
            ["name"],
            ["url"],
            ["query"],
            ["path"]
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
    });
});

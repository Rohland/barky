import { Result } from "./result";

describe("result", () => {
    describe("isDigestable", () => {
        describe("when has alert channels", () => {
            it("should return true", async () => {
                // arrange
                const result = getTestResult();

                // act
                const digestable = result.isDigestable;

                // assert
                expect(digestable).toEqual(true);
            });
        });
        describe("with no alert", () => {
            it("is not digestable", async () => {
                // arrange
                const result = getTestResult();
                result.alert = null;

                // act
                const digestable = result.isDigestable;

                // assert
                expect(digestable).toEqual(false);
            });
        });
        describe("with alert but no channels", () => {
            it("is not digestable", async () => {
                // arrange
                const result = getTestResult();
                result.alert.channels = [];

                // act
                const digestable = result.isDigestable;

                // assert
                expect(digestable).toEqual(false);
            });
        });
    });
});

export function getTestResult()  {
    return new Result(
        new Date(),
        "web",
        "health",
        "www.codeo.co.za",
        false,
        "FAIL",
        0,
        false,
        {
            alert: {
                channels: ["console"]
            }
        }
    );
}

import { getAppVariations } from "./app";

describe("getVariations", () => {
    describe("with no vary-by", () => {
        describe.each([
            [null],
            [undefined],
            [],
            [""]
        ])(`when given %s`, (varyBy) => {
            it("should return app as is", async () => {
                // arrange
                const app = {
                    name: "codeo.co.za",
                    url: "https://www.codeo.co.za",
                    "vary-by": varyBy
                };

                // act
                const result = getAppVariations(app);

                // assert
                expect(result).toEqual([{
                    name: "codeo.co.za",
                    url: "https://www.codeo.co.za"
                }]);
            });
        });
        describe("with app name", () => {
            it("should keep it", async () => {
                // arrange
                const app = {
                    name: "test",
                    url: "https://www.codeo.co.za",
                };

                // act
                const result = getAppVariations(app);

                // assert
                expect(result).toEqual([{
                    name: "test",
                    url: "https://www.codeo.co.za"
                }]);
            });
        });
        describe("with vary-by", () => {
            describe("names", () => {
                describe.each([
                    [null, "codeo", ["codeo"]],
                    [undefined, "codeo", ["codeo"]],
                    [[], "codeo", ["codeo"]],
                    [["a"], "codeo-$1", ["codeo-a"]],
                    [["a", "b"], "codeo-$1", ["codeo-a", "codeo-b"]],
                    [[["a", "b"]], "codeo-$1-$2", ["codeo-a-b"]],
                ])(`when given %s`, (varyBy, name, expected) => {
                    it("should return variant names", async () => {
                        const app = {
                            "vary-by": varyBy,
                            name
                        };

                        // act
                        const result = getAppVariations(app);

                        // assert
                        const expectedResults = expected.map(x => ({
                            name: x,
                        }));
                        expect(result).toEqual(expectedResults);
                    });
                });
            });
            describe("urls", () => {
                describe.each([
                    [null, "www.codeo.co.za/$1", ["www.codeo.co.za/$1"]],
                    [undefined, "www.codeo.co.za/$1", ["www.codeo.co.za/$1"]],
                    [[], "www.codeo.co.za/$1", ["www.codeo.co.za/$1"]],
                    [["a"], "www.codeo.co.za/$1", ["www.codeo.co.za/a"]],
                    [["a", "b"], "www.codeo.co.za/$1", ["www.codeo.co.za/a", "www.codeo.co.za/b"]],
                    [["a", "b"], "www.codeo.co.za/$1/$2", ["www.codeo.co.za/a/$2", "www.codeo.co.za/b/$2"]],
                    [[["a",1], ["b",2]], "www.codeo.co.za/$1/$2", ["www.codeo.co.za/a/1", "www.codeo.co.za/b/2"]],
                ])(`when given %s`, (varyBy, url, expected) => {
                    it("should return expected", async () => {
                        const app = {
                            name: "codeo",
                            url: url,
                            "vary-by": varyBy
                        };

                        // act
                        const result = getAppVariations(app);

                        // assert
                        const expectedResults = expected.map(x => ({
                            name: "codeo",
                            url: x
                        }));
                        expect(result).toEqual(expectedResults);
                    });
                });
            });
        });
    });
});

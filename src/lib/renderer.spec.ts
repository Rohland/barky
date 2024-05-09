import { renderTemplate } from "./renderer";

describe("renderTemplate", () => {
    describe.each([
        null,
        undefined,
        "",
        "\t"
    ])(`with invalid template`, (template) => {
        it("should return blank", async () => {
            // arrange
            // act
            const result = renderTemplate(template, {});
            // assert
            expect(result).toEqual("");
        });
    });
    describe("with valid template but no data", () => {
        it("should render template", async () => {
            // arrange
            const template = "Test {{value}}"
            // act
            const result = renderTemplate(template, null);

            // assert
            expect(result).toEqual(template);
        });
    });
    describe.each([
        ["Test {{value}}", { value: "123" }, "Test 123"],
        ["Test {{ value  }}", { value: "123" }, "Test 123"],
        ["Test {{VALUE}}", { value: "123" }, "Test 123"],
        ["Test {{value}}", { VALUE: "123" }, "Test 123"],
        ["Test {{value}}", { value: null }, "Test null"],
        ["Test {{value}}", { value: undefined }, "Test undefined"],
        ["Test {{value}}", { value: "123", other: "456" }, "Test 123"],
        ["Test {{value}} {{value}} {value}", { value: "123", other: "456" }, "Test 123 123 {value}"],
    ])(`with valid template and data`, (template, data, expected) => {
        it("should return expected", async () => {
            // arrange
            // act
            const result = renderTemplate(template, data);
            // assert
            expect(result).toEqual(expected);
        });
    });
    describe("with humanizeNumbers turned on", () => {
        describe.each([
            ["Test {{ value }}", { value: 1 }, "Test 1"],
            ["Test {{ value }}", { value: "abc" }, "Test abc"],
            ["Test {{ value }}", { value: 0.0001 }, "Test 0.0001"],
            ["Test {{ value }}", { value: 10.2123 }, "Test 10.21"],
            ["Test {{ value }}", { value: -10 }, "Test -10"],
            ["Test {{ value }}", { value: 100 }, "Test 100"],
            ["Test {{ value }}", { value: 1000 }, "Test 1k"],
            ["Test {{ value }}", { value: 1500 }, "Test 1.5k"],
            ["Test {{ value }}", { value: 1908 }, "Test 1.91k"],
            ["Test {{ value }}", { value: 1990 }, "Test 1.99k"],
            ["Test {{ value }}", { value: -1990 }, "Test -1.99k"],
            ["Test {{ value }}", { value: 10300 }, "Test 10.3k"],
            ["Test {{ value }}", { value: 10350 }, "Test 10.35k"],
            ["Test {{ value }}", { value: 156000 }, "Test 156k"],
            ["Test {{ value }}", { value: 199102 }, "Test 199.1k"],
            ["Test {{ value }}", { value: 199902 }, "Test 199.9k"],
            ["Test {{ value }}", { value: 982000 }, "Test 982k"],
            ["Test {{ value }}", { value: 1000000 }, "Test 1M"],
            ["Test {{ value }}", { value: 1100000 }, "Test 1.1M"],
            ["Test {{ value }}", { value: 1890000 }, "Test 1.89M"],
            ["Test {{ value }}", { value: 10540000 }, "Test 10.54M"],
            ["Test {{ value }}", { value: -10540000 }, "Test -10.54M"],
            ["Test {{ value }}", { value: 100540000 }, "Test 100.54M"],
            ["Test {{ value }}", { value: "hello" }, "Test hello"],
            ["Test {{ value }}", { value: "192.168.0.1" }, "Test 192.168.0.1"]
        ])(`with template %s`, (template, data, expected) => {
            it("should return expected", async () => {
                // arrange
                const options = {
                    humanizeNumbers: true
                };
                // act
                const result = renderTemplate(template, data, options);
                // assert
                expect(result).toEqual(expected);
            });
        });
    });

});

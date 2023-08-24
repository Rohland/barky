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
        ["Test {{value}}", {value: "123"}, "Test 123"],
        ["Test {{ value  }}", {value: "123"}, "Test 123"],
        ["Test {{VALUE}}", {value: "123"}, "Test 123"],
        ["Test {{value}}", {VALUE: "123"}, "Test 123"],
        ["Test {{value}}", {value: null}, "Test null"],
        ["Test {{value}}", {value: undefined}, "Test undefined"],
        ["Test {{value}}", {value: "123", other: "456"}, "Test 123"],
        ["Test {{value}} {{value}} {value}", {value: "123", other: "456"}, "Test 123 123 {value}"],
    ])(`with valid template and data`, (template, data, expected) => {
        it("should return expected", async () => {
            // arrange
            // act
            const result = renderTemplate(template, data);
            // assert
            expect(result).toEqual(expected);
        });
    });
});

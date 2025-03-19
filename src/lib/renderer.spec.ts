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
        ["Test {{VALUE}}", { VALUE: "321", value: "123" }, "Test 321"],
        ["Test {{value}}", { VALUE: "123" }, "Test 123"],
        ["Test {{value}}", { value: null }, "Test null"],
        ["Test {{value}}", { value: undefined }, "Test undefined"],
        ["Test {{value}}", { value: "123", other: "456" }, "Test 123"],
        ["Test {{value}} {{value}} {value}", { value: "123", other: "456" }, "Test 123 123 {value}"],
        ["Test {{value.sub_value}}", { value: { sub_value: "99" } }, "Test 99"],
    ])(`with valid template %p and data %p`, (template, data, expected) => {
        it("should return expected", async () => {
            // arrange
            // act
            const result = renderTemplate(template, data);
            // assert
            expect(result).toEqual(expected);
        });
    });
    describe("with expression that can be evaluated", () => {
        it("is evaluated", async () => {
            const template = "Test {{value + value2 + 5}}"
            const data = { value: 1, value2: 2 };
            expect(renderTemplate(template, data)).toEqual("Test 8");
        });
        it("can support sub-objects", async () => {
            const template = "Test {{value.sub_value}}"
            const data = { value: { sub_value: 321 } };
            expect(renderTemplate(template, data)).toEqual("Test 321");
        });
        it("can support coalesce", async () => {
            const template = "Test {{value?.test ?? '123'}}"
            const data = { value: null };
            expect(renderTemplate(template, data)).toEqual("Test 123");
        });
    });

    describe("with humanizeDuration used", () => {
        describe.each([
            ["Test {{  humanizeDuration(value) }}", { value: 1 }, "Test 1m"],
            ["Test {{  humanizeDuration(value, 's') }}", { value: 60 }, "Test 1m"],
            ["Test {{  humanizeDuration(value, 's') }}", { value: 65 }, "Test 1m and 5s"],
            ["Test {{  humanizeDuration(value, 's') }}", { value: 300 }, "Test 5m"],
            ["Test {{  humanizeDuration(value, 'h') }}", { value: 24 }, "Test 24h"],
        ])(`with template %s`, (template, data, expected) => {
            it("should return expected", () => {
                // act
                const result = renderTemplate(template, data);
                // assert
                expect(result).toEqual(expected);
            });
        });
    });

    describe("with humanizeNum function used", () => {
        describe.each([
            ["Test {{  humanizeNum(value) }}", { value: 1 }, "Test 1"],
            ["Test {{  humanizeNum(value) }}", { value: "abc" }, "Test abc"],
            ["Test {{  humanizeNum(value) }}", { value: 0.0001 }, "Test 0.0001"],
            ["Test {{  humanizeNum(value) }}", { value: 10.2123 }, "Test 10.21"],
            ["Test {{  humanizeNum(value) }}", { value: -10 }, "Test -10"],
            ["Test {{  humanizeNum(value) }}", { value: 100 }, "Test 100"],
            ["Test {{  humanizeNum(value) }}", { value: 1000 }, "Test 1k"],
            ["Test {{  humanizeNum(value) }}", { value: 1500 }, "Test 1.5k"],
            ["Test {{  humanizeNum(value) }}", { value: 1908 }, "Test 1.91k"],
            ["Test {{  humanizeNum(value) }}", { value: 1990 }, "Test 1.99k"],
            ["Test {{  humanizeNum(value) }}", { value: -1990 }, "Test -1.99k"],
            ["Test {{  humanizeNum(value) }}", { value: 10300 }, "Test 10.3k"],
            ["Test {{  humanizeNum(value) }}", { value: 10350 }, "Test 10.35k"],
            ["Test {{  humanizeNum(value) }}", { value: 156000 }, "Test 156k"],
            ["Test {{  humanizeNum(value) }}", { value: 199102 }, "Test 199.1k"],
            ["Test {{  humanizeNum(value) }}", { value: 199902 }, "Test 199.9k"],
            ["Test {{  humanizeNum(value) }}", { value: 982000 }, "Test 982k"],
            ["Test {{  humanizeNum(value) }}", { value: 1000000 }, "Test 1M"],
            ["Test {{  humanizeNum(value) }}", { value: 1100000 }, "Test 1.1M"],
            ["Test {{  humanizeNum(value) }}", { value: 1890000 }, "Test 1.89M"],
            ["Test {{  humanizeNum(value) }}", { value: 10540000 }, "Test 10.54M"],
            ["Test {{  humanizeNum(value) }}", { value: -10540000 }, "Test -10.54M"],
            ["Test {{  humanizeNum(value) }}", { value: 100540000 }, "Test 100.54M"],
            ["Test {{  humanizeNum(value) }}", { value: "hello" }, "Test hello"],
            ["Test {{  humanizeNum(value) }}", { value: "192.168.0.1" }, "Test 192.168.0.1"]
        ])(`with template %s`, (template, data, expected) => {
            it("should return expected", async () => {
                // act
                const result = renderTemplate(template, data);
                // assert
                expect(result).toEqual(expected);
            });
        });
    });
});

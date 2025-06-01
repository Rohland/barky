import { formatType } from "./type";

describe("formatType", () => {
    describe.each([
        [null, null],
        [undefined, undefined],
        [NaN, NaN],
        [{ a: 1}, {a: 1}],
        ["", ""],
        ["test", "test"],
        [-1, -1],
        [0,0],
        [1, 1],
        [.1, 0.1],
        [-.1, -0.1],
        [1.23456789, 1.235],
        ["192.168.0.1", "192.168.0.1"],
        [12345678901234567890, 12345678901234567890],
        [12345678901234567890.123456789, 12345678901234567890.123]
    ])("when value is %s", (value, expected) => {
        it(`should return ${expected}`, () => {
            const result = formatType(value);
            expect(result).toEqual(expected);
        });
    });
});

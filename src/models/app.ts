import { IAlertConfig } from "./alert_configuration.js";
import { flatten } from "../lib/utility.js";
import { ITrigger } from "./trigger.js";

export interface IApp {
    [key: string]: any;
    name?: string;
    quiet?: boolean;
    timeout?: number;
    alert?: IAlertConfig;
    every?: string;
    type?: string;
    triggers?: ITrigger[];
    __configPath?: string;
}

export class AppVariant implements IApp {
    [key: string]: any;

    constructor(app: any, variantInfo: null | string | string[]) {
        const fieldsToTransform = [
            "name",
            "path",
            "query",
            "url",
            "connection",
            "alert.channels"];
        fieldsToTransform.forEach(field => {
            const value = AppVariant.extractFieldValue(app, field);
            if (!value) {
                return;
            }
            if (Array.isArray(value)) {
                AppVariant.setFieldValue(this, field, value.map(x => this.transform(variantInfo, x)));
            } else {
                AppVariant.setFieldValue(this, field, this.transform(variantInfo, value));
            }
        });
        this["variation"] = [variantInfo].flat() ?? null;
    }

    private static extractFieldValue(obj: any, field: string): string {
        const parts = field.split(".");
        if (parts.length === 1) {
            return obj[field];
        }
        const next = obj[parts[0]];
        if (next === undefined || next === null) {
            return next;
        }
        parts.shift();
        return AppVariant.extractFieldValue(next, parts.join("."));
    }

    private static setFieldValue(obj, path, value) {
        const keys = path.split('.');
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (current[key] == null) {
                current[key] = {};
            }
            current = current[key];
        }
        current[keys[keys.length - 1]] = value;
    }

    private transform(variantInfo: string | string[], field: string) {
        if (!variantInfo) {
            return field;
        }
        const parts: string[] = flatten([variantInfo]);
        parts.forEach((part, index) => {
            field = field?.replaceAll(`$${ index + 1 }`, part);
        });
        return field;
    }
}

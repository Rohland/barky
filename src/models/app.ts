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
        const fieldsToTransform = ["name", "path", "query", "url", "connection"];
        fieldsToTransform.forEach(field => {
            if (!app[field]) {
                return;
            }
            this[field] = this.transform(variantInfo, app[field])
        });
        this["variation"] = [variantInfo].flat() ?? null;
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

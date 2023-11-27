import { IAlertConfig } from "./alert_configuration";
import { flatten } from "../lib/utility";
import { ITrigger } from "./trigger";

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
        const fieldsToTransform = ["name", "path", "query", "url"];
        fieldsToTransform.forEach(field => {
            if (!app[field]) {
                return;
            }
            this[field] = this.transform(variantInfo, app[field])
        });
    }

    private transform(variantInfo, field) {
        if (!variantInfo) {
            return field;
        }
        const parts = flatten([variantInfo]);
        parts.forEach((part, index) => {
            field = field?.replaceAll(`$${ index + 1 }`, part);
        });
        return field;
    }
}

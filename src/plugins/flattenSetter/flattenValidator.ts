import { Session } from "@azure-tools/autorest-extension-base";
import { CodeModel, isObjectSchema, ObjectSchema, Property } from "@azure-tools/codemodel";
import { isNullOrUndefined } from "util";
import { CliConst } from "../../schema";
import { Helper } from "../../helper";
import { NodeHelper } from "../../nodeHelper";

const BASECLASS_INDICATOR = '*';
const CIRCLE_VICIM_INDICATOR = '#';

class PropertyInfo {
    public isFlatten: boolean = false;
    public isPointToBaseClass: boolean = false;
    public isCirculeVictim: boolean = false;

    public get nodeKey() {
        return this.property.schema.language.default.name;
    }

    constructor(public property: Property) {
        this.isFlatten = NodeHelper.isFlattened(property);
        this.isPointToBaseClass = NodeHelper.HasSubClass(property.schema as ObjectSchema);
    }

    public toOutputString(withClass: boolean) {
        return `${this.property.language.default.name}${this.isPointToBaseClass ? BASECLASS_INDICATOR : ''}${this.isCirculeVictim ? CIRCLE_VICIM_INDICATOR : ''}${withClass ? ':' + this.property.schema.language.default.name : ''}`;
    }

    public unflattenAsCirculeVictim() {
        NodeHelper.setFlatten(this.property, false, true);
        this.isCirculeVictim = true;
    }
}

class NodeInfo {
    public isBaseClass: boolean = false;
    public flattenProperty: PropertyInfo[] = [];
    public unflattenProperty: PropertyInfo[] = [];

    public get key() {
        return this.node.language.default.name;
    }

    constructor(public node: ObjectSchema) {
        this.refresh();
    }

    public refresh() {
        this.isBaseClass = NodeHelper.HasSubClass(this.node);
        this.flattenProperty = [];
        this.unflattenProperty = [];
        if (!isNullOrUndefined(this.node.properties) && this.node.properties.length > 0) {
            for (let i = 0; i < this.node.properties.length; i++) {
                let p = this.node.properties[i];
                if (isObjectSchema(p.schema)) {
                    NodeHelper.isFlattened(p) ? this.flattenProperty.push(new PropertyInfo(p)) : this.unflattenProperty.push(new PropertyInfo(p));
                }
            }
        }
    }

    public toOutputString(withPropertyClass: boolean) {
        return this.node.language.default.name +
            `<${isNullOrUndefined(this.node.properties) ? '0' : this.node.properties.length}>` +
            (this.isBaseClass ? BASECLASS_INDICATOR : '') +
            (this.unflattenProperty.length == 0 ? '' : `(${this.unflattenProperty.map(pi => pi.toOutputString(withPropertyClass)).join(', ')})`);
    }
};

class NodeLink {
    constructor(public preNode: NodeInfo, public linkProperty: PropertyInfo) {
    }

    public toOutputString() {
        if (isNullOrUndefined(this.linkProperty))
            return this.preNode.toOutputString(true);
        else
            return `${this.preNode.toOutputString(true)}[${this.linkProperty.toOutputString(false)}]`;
    }
}

class NodePath {
    constructor(public path: NodeLink[]) {
    }

    public toOutputString() {
        return isNullOrUndefined(this.path) || this.path.length == 0 ? '<emptyNodePath>' : this.path.map(l => l.toOutputString()).join(' -> ');
    }
}

export class FlattenValidator {
    codeModel: CodeModel;

    constructor(protected session: Session<CodeModel>) {
        this.codeModel = session.model;
    }

    visitNode(ni: NodeInfo, pre: NodeLink[], founds: NodePath[], visited: Set<string>) {

        visited.add(ni.key);

        for (let i = ni.flattenProperty.length - 1; i >= 0; i--) {
            let pi = ni.flattenProperty[i];
            let ppre = pre.concat(new NodeLink(ni, pi));
            let index = ppre.findIndex((v, i, o) => v.preNode.key === pi.nodeKey);

            if (index >= 0) {
                Helper.logWarning('Circle found in flatten: ' + new NodePath(ppre).toOutputString() + ' ==> ' + pi.toOutputString(true));
                Helper.logWarning('disable flatten on: ' + pi.toOutputString(true));
                pi.unflattenAsCirculeVictim();

                ni.unflattenProperty.push(ni.flattenProperty.splice(i, 1)[0]);
            }
        }

        ni.flattenProperty.forEach(pi => {
            this.visitNode(new NodeInfo(pi.property.schema as ObjectSchema), pre.concat(new NodeLink(ni, pi)), founds, visited);
        })

        if (ni.flattenProperty.length == 0) {
            founds.push(new NodePath(pre.concat(new NodeLink(ni, null))));
        }
    }

    public validate(objects: ObjectSchema[]): string {

        let result: NodePath[] = [];
        let visited = new Set<string>();
        objects.forEach(o => {
            let ni = new NodeInfo(o);
            if (!visited.has(ni.key))
                this.visitNode(ni, [], result, visited);
        });
        return result.map(p => p.toOutputString()).join('\n');
    }
}
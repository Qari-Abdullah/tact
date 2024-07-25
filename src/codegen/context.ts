import { CompilerContext } from "../context";
import { topologicalSort } from "../utils/utils";
import {
    FuncAstFunctionDefinition,
    FuncAstAsmFunction,
    FuncAstFunctionAttribute,
    FuncAstIdExpr,
    FuncType,
    FuncAstStmt,
} from "../func/syntax";
import { asmfun, fun, FunParamValue } from "../func/syntaxConstructors";
import { forEachExpression } from "../func/iterators";

/**
 * An additional information on how to handle the function definition.
 * TODO: Refactor: we need only the boolean `skip` field in WrittenFunction.
 * TODO: We don't need even `skip`. These are merely names without signature saved within the context.
 * XXX: Writer.ts: `Body.kind`
 */
export type BodyKind = "asm" | "skip" | "generic";

export type FunctionInfo = {
    kind: BodyKind;
    context: LocationContext;
    inMainContract: boolean;
};

/**
 * Replicates the `ctx.context` parameter of the old backends Writer context.
 * Basically, it tells in which file the context value should be located in the
 * generated Func code.
 *
 * TODO: Should be refactored; `type` seems to be redundant
 */
export type LocationContext =
    | { kind: "stdlib" }
    | { kind: "constants" }
    | { kind: "type"; value: string };

export function locEquals(lhs: LocationContext, rhs: LocationContext): boolean {
    if (lhs.kind !== rhs.kind) {
        return false;
    }
    if (lhs.kind === "type" && rhs.kind === "type") {
        return lhs.value === rhs.value;
    }
    return true;
}

/**
 * Returns string value of the location context "as in the old backend".
 */
export function locValue(loc: LocationContext): string {
    return loc.kind === "type" ? `type:${loc.value}` : loc.kind;
}

export class Location {
    public static stdlib(): LocationContext {
        return { kind: "stdlib" };
    }

    public static constants(): LocationContext {
        return { kind: "constants" };
    }

    public static type(value: string): LocationContext {
        return { kind: "type", value };
    }
}

export type WrittenFunction = {
    name: string;
    definition: FuncAstFunctionDefinition | FuncAstAsmFunction | undefined;
    kind: BodyKind;
    context: LocationContext | undefined;
    depends: Set<string>;
    inMainContract: boolean; // true iff it should be placed in $main in the old backend
};

/**
 * The context containing objects generated by the codegen and stores the
 * required intermediate information.
 *
 * It implements the original WriterContext, but keeps AST elements instead and
 * doesn't pretend to implement any formatting/code emitting logic.
 */
export class WriterContext {
    public readonly ctx: CompilerContext;

    /** Generated functions. */
    private functions: Map<string, WrittenFunction> = new Map();

    constructor(ctx: CompilerContext) {
        this.ctx = ctx;
    }

    /**
     * Analyses the AST of the function saving names of the functions it calls under the hood.
     */
    private addDependencies(
        fun: FuncAstFunctionDefinition,
        depends: Set<string>,
    ): void {
        forEachExpression(fun, (expr) => {
            // TODO: It doesn't save receivers. But should it?
            if (expr.kind === "call_expr" && expr.fun.kind === "id_expr") {
                depends.add(expr.fun.value);
            }
        });
    }

    /**
     * Saves an information about the function in the context automatically extracting
     * info about the dependencies: functions that it calls.
     */
    public save(
        value:
            | FuncAstFunctionDefinition
            | FuncAstAsmFunction
            | { name: string; kind: "name_only" },
        params: Partial<FunctionInfo> = {},
    ): void {
        const {
            kind = "generic",
            context = undefined,
            inMainContract = false,
        } = params;
        let name: string;
        let definition:
            | FuncAstFunctionDefinition
            | FuncAstAsmFunction
            | undefined;
        if (value.kind === "name_only") {
            name = value.name;
            definition = undefined;
        } else {
            const defValue = value as
                | FuncAstFunctionDefinition
                | FuncAstAsmFunction;
            name = defValue.name.value;
            definition = defValue;
        }
        const depends = new Set<string>();
        if (value.kind === "function_definition") {
            this.addDependencies(value, depends);
        }
        this.functions.set(name, {
            name,
            definition,
            kind,
            context,
            depends,
            inMainContract,
        });
    }

    /**
     * Wraps the function definition constructor saving it to the context.
     * XXX: Replicates old WriterContext.fun
     */
    public fun(
        attrs: FuncAstFunctionAttribute[],
        name: string | FuncAstIdExpr,
        paramValues: FunParamValue[],
        returnTy: FuncType,
        body: FuncAstStmt[],
        params: Partial<FunctionInfo> = {},
    ): FuncAstFunctionDefinition {
        const f = fun(attrs, name, paramValues, returnTy, body);
        this.save(f, params);
        return f;
    }

    /**
     * Saves the function name in the context.
     * XXX: Replicates old WriterContext.skip
     */
    public skip(name: string, params: Partial<FunctionInfo> = {}): void {
        this.save({ name, kind: "name_only" }, params);
    }

    /**
     * Wraps the asm function definition constructor saving it to the context.
     * XXX: Replicates old WriterContext.asm
     */
    public asm(
        attrs: FuncAstFunctionAttribute[],
        name: string | FuncAstIdExpr,
        paramValues: FunParamValue[],
        returnTy: FuncType,
        rawAsm: string,
        params: Partial<FunctionInfo> = {},
    ): FuncAstAsmFunction {
        const f = asmfun(attrs, name, paramValues, returnTy, rawAsm);
        this.save(f, params);
        return f;
    }

    public hasFunction(name: string): boolean {
        return this.functions.has(name);
    }

    private allFunctions(): WrittenFunction[] {
        return Array.from(this.functions.values());
    }

    // Functions that are defined in the $main "section" of the old backend.
    private mainFunctions(): WrittenFunction[] {
        return this.allFunctions().filter((f) => f.inMainContract);
    }

    public extract(debug: boolean = false): WrittenFunction[] {
        // All functions
        let all = this.allFunctions();

        // Remove unused
        const used: Set<string> = new Set();
        const visit = (name: string) => {
            used.add(name);
            const f = this.functions.get(name);
            if (f !== undefined) {
                for (const d of f.depends) {
                    visit(d);
                }
            }
        };
        this.mainFunctions().forEach((f) => visit(f.name));
        all = all.filter((v) => used.has(v.name));

        // Sort functions
        const sorted = topologicalSort(all, (f) => {
            if (f !== undefined) {
                return Array.from(f.depends).map((v) => this.functions.get(v)!);
            } else {
                // TODO: This will be resolved when all the required functions are added to the new backend.
                return [];
            }
        }).filter((f) => f !== undefined);

        return sorted;
    }
}
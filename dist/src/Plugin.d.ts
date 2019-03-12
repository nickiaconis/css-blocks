import { TemplateTypes } from "@opticss/template-api";
import * as debugGenerator from "debug";
import * as Tapable from "tapable";
import { Compiler as WebpackCompiler, Plugin as WebpackPlugin } from "webpack";
import { Analyzer as AnalyzerType, Options as CSSBlocksOptions, StyleMapping } from "@css-blocks/core";
import { Actions, OptiCSSOptions } from "opticss";
export declare type TmpType = keyof TemplateTypes;
export declare type Analyzer = AnalyzerType<TmpType>;
export declare type PendingResult = Promise<StyleMapping<TmpType> | void>;
export interface CssBlocksWebpackOptions {
    name?: string;
    analyzer: Analyzer;
    outputCssFile?: string;
    compilationOptions?: CSSBlocksOptions;
    optimization?: OptiCSSOptions;
}
export declare type WebpackAny = any;
export interface BlockCompilationError {
    compilation: WebpackAny;
    assetPath: string;
    error: Error;
    mapping?: StyleMapping<TmpType>;
    optimizerActions?: Actions;
}
export interface BlockCompilationComplete {
    compilation: WebpackAny;
    assetPath: string;
    mapping: StyleMapping<TmpType>;
    optimizerActions: Actions;
}
export declare class CssBlocksPlugin extends Tapable implements WebpackPlugin {
    optimizationOptions: OptiCSSOptions;
    name: string;
    analyzer: Analyzer;
    projectDir: string;
    outputCssFile: string;
    compilationOptions: CSSBlocksOptions;
    pendingResult?: PendingResult;
    debug: debugGenerator.IDebugger;
    constructor(options: CssBlocksWebpackOptions);
    private handleMake;
    apply(compiler: WebpackCompiler): void;
    private compileBlocks;
    trace(message: string): void;
    /**
     * Fires when the compilation promise is available.
     */
    onPendingCompilation(handler: (pendingResult: PendingResult) => void): void;
    private notifyPendingCompilation;
    /**
     * Fires when the compilation is first started to let any listeners know that
     * their current promise is no longer valid.
     */
    onCompilationExpiration(handler: () => void): void;
    private notifyCompilationExpiration;
    /**
     * Fires when the compilation is done.
     */
    onComplete(handler: (result: BlockCompilationComplete | BlockCompilationError, cb: (err: Error) => void) => void): void;
    private notifyComplete;
}

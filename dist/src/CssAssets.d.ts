import { ObjectDictionary } from "@opticss/util";
import { postcss } from "opticss";
import { Compiler as WebpackCompiler } from "webpack";
import { Source } from "webpack-sources";
export declare type PostcssAny = any;
export declare type PostcssProcessor = Array<postcss.Plugin<PostcssAny>> | ((assetPath: string) => Array<postcss.Plugin<PostcssAny>> | Promise<Array<postcss.Plugin<PostcssAny>>>);
export declare type GenericProcessor = (source: Source, assetPath: string) => Source | Promise<Source>;
export interface PostcssProcessorOption {
    postcss: PostcssProcessor;
}
export interface GenericProcessorOption {
    processor: GenericProcessor;
}
export declare type PostProcessorOption = PostcssProcessorOption | GenericProcessorOption | (PostcssProcessorOption & GenericProcessorOption);
export interface CssSourceOptions {
    /**
     * The name of the chunk to which the asset should belong.
     * If omitted, the asset won't belong to a any chunk. */
    chunk: string | undefined;
    /** the source path to the css asset. */
    source: string | string[];
}
export interface ConcatenationOptions {
    /**
     * A list of assets to be concatenated.
     */
    sources: Array<string>;
    /**
     * When true, the files that are concatenated are left in the build.
     * Defaults to false.
     */
    preserveSourceFiles?: boolean;
    /**
     * Post-process the concatenated file with the specified postcss plugins.
     *
     * If postcss plugins are provided in conjunction with a generic processor
     * the postcss plugins will be ran first.
     */
    postProcess?: PostProcessorOption;
}
/**
 * Options for managing CSS assets without javascript imports.
 */
export interface CssAssetsOptions {
    /** Maps css files from a source location to a webpack asset location. */
    cssFiles: ObjectDictionary<string | CssSourceOptions>;
    /**
     * Maps several webpack assets to a new concatenated asset and manages their
     * sourcemaps. The concatenated asset will belong to all the chunks to which
     * the assets belonged.
     */
    concat: ObjectDictionary<string[] | ConcatenationOptions>;
    /**
     * When true, any source maps related to the assets are written out as
     * additional files or inline depending on the value of `inlineSourceMaps`.
     */
    emitSourceMaps: boolean;
    /**
     * Whether source maps should be included in the css file itself. This
     * should only be used in development.
     */
    inlineSourceMaps: boolean;
}
export declare class CssAssets {
    options: CssAssetsOptions;
    constructor(options: Partial<CssAssetsOptions>);
    apply(compiler: WebpackCompiler): void;
}

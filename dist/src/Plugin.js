"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = require("@opticss/util");
const debugGenerator = require("debug");
const opticss_1 = require("opticss");
const path = require("path");
const Tapable = require("tapable");
const webpack_sources_1 = require("webpack-sources");
const core_1 = require("@css-blocks/core");
const opticss_2 = require("opticss");
class CssBlocksPlugin extends Tapable {
    constructor(options) {
        super();
        this.debug = debugGenerator("css-blocks:webpack");
        this.analyzer = options.analyzer;
        this.outputCssFile = options.outputCssFile || "css-blocks.css";
        this.name = options.name || this.outputCssFile;
        this.compilationOptions = options.compilationOptions || {};
        this.projectDir = process.cwd();
        this.optimizationOptions = Object.assign({}, opticss_2.DEFAULT_OPTIONS, options.optimization);
    }
    handleMake(outputPath, assets, compilation, cb) {
        return __awaiter(this, void 0, void 0, function* () {
            // Start analysis with a clean analysis object
            this.trace(`starting analysis.`);
            this.analyzer.reset();
            // Fetch our app's entry points.
            let webpackEntry = compilation.options.entry;
            let entries = [];
            // Zomg webpack, so many config format options.
            if (typeof webpackEntry === "string") {
                entries = [webpackEntry];
            }
            else if (Array.isArray(webpackEntry)) {
                entries = webpackEntry;
            }
            else if (typeof webpackEntry === "object") {
                entries = util_1.flatten(util_1.objectValues(webpackEntry));
            }
            // Zomg webpack-dev-server, injecting fake paths into the entry points.
            entries = entries.filter(entry => !/\/webpack-dev-server\/|^webpack\/hot\/dev-server$/.test(entry));
            let pending = this.analyzer.analyze("", entries)
                // If analysis fails, drain our BlockFactory, add error to compilation error list and propagate.
                .catch((err) => {
                this.trace(`Error during analysis. Draining queue.`);
                return this.analyzer.blockFactory.prepareForExit().then(() => {
                    this.trace(`Drained. Raising error.`);
                    throw err; // We're done, throw to skip the rest of the plugin steps below.
                });
            })
                // If analysis finished successfully, compile our blocks to output.
                .then((analysis) => {
                return this.compileBlocks(analysis, path.join(outputPath, this.outputCssFile));
            })
                // Add the resulting css output to our build.
                .then((result) => {
                this.trace(`setting css asset: ${this.outputCssFile}`);
                let source;
                if (result.optimizationResult.output.sourceMap) {
                    let resultMap = result.optimizationResult.output.sourceMap;
                    let rawSourceMap;
                    if (typeof resultMap === "string") {
                        rawSourceMap = JSON.parse(resultMap);
                    }
                    else {
                        rawSourceMap = resultMap;
                    }
                    source = new webpack_sources_1.SourceMapSource(result.optimizationResult.output.content.toString(), "optimized css", rawSourceMap);
                }
                else {
                    source = new webpack_sources_1.RawSource(result.optimizationResult.output.content.toString());
                }
                assets[`${this.outputCssFile}.log`] = new webpack_sources_1.RawSource(result.optimizationResult.actions.performed.map(a => a.logString()).join("\n"));
                assets[this.outputCssFile] = source;
                let completion = {
                    compilation: compilation,
                    assetPath: this.outputCssFile,
                    mapping: new core_1.StyleMapping(result.optimizationResult.styleMapping, result.blocks, core_1.resolveConfiguration(this.compilationOptions), result.analyses),
                    optimizerActions: result.optimizationResult.actions,
                };
                return completion;
            })
                // Notify the world when complete.
                .then((completion) => {
                this.trace(`notifying of completion`);
                this.notifyComplete(completion, cb);
                this.trace(`notified of completion`);
                return completion;
            })
                // Return just the mapping object from this promise.
                .then((compilationResult) => {
                return compilationResult.mapping;
            })
                // If something bad happened, log the error and pretend like nothing happened
                // by notifying deps of completion and returning an empty MetaStyleMapping
                // so compilation can continue.
                .catch((error) => {
                this.trace(`notifying of compilation failure`);
                compilation.errors.push(error);
                this.notifyComplete({
                    error,
                    compilation,
                    assetPath: this.outputCssFile,
                }, cb);
                this.trace(`notified of compilation failure`);
            });
            this.trace(`notifying of pending compilation`);
            this.notifyPendingCompilation(pending);
            this.trace(`notified of pending compilation`);
        });
    }
    apply(compiler) {
        this.projectDir = compiler.options.context || this.projectDir;
        let outputPath = compiler.options.output && compiler.options.output.path || this.projectDir; // TODO What is the webpack default output directory?
        let assets = {};
        compiler.plugin("this-compilation", (compilation) => {
            this.notifyCompilationExpiration();
            compilation.plugin("additional-assets", (cb) => {
                Object.assign(compilation.assets, assets);
                cb();
            });
        });
        compiler.plugin("make", this.handleMake.bind(this, outputPath, assets));
        // Once we're done, add all discovered block files to the build dependencies
        // so this plugin is re-evaluated when they change.
        // TODO: We get timestamp data here. We can probably intelligently re-build.
        compiler.plugin("emit", (compilation, callback) => {
            let discoveredFiles = [...this.analyzer.transitiveBlockDependencies()].map((b) => b.identifier);
            compilation.fileDependencies.push(...discoveredFiles);
            callback();
        });
        this.onCompilationExpiration(() => {
            this.trace(`resetting pending compilation.`);
            this.pendingResult = undefined;
        });
        this.onPendingCompilation((pendingResult) => {
            this.trace(`received pending compilation.`);
            this.pendingResult = pendingResult;
        });
        compiler.plugin("compilation", (compilation) => {
            compilation.plugin("normal-module-loader", (context, mod) => {
                this.trace(`preparing normal-module-loader for ${mod.resource}`);
                context.cssBlocks = context.cssBlocks || { mappings: {}, compilationOptions: this.compilationOptions };
                // If we're already waiting for a css file of this name to finish compiling, throw.
                if (context.cssBlocks.mappings[this.outputCssFile]) {
                    throw new Error(`css conflict detected. Multiple compiles writing to ${this.outputCssFile}?`);
                }
                if (this.pendingResult === undefined) {
                    throw new Error(`No pending result is available yet.`);
                }
                context.cssBlocks.mappings[this.outputCssFile] = this.pendingResult;
            });
        });
    }
    compileBlocks(analyzer, cssOutputName) {
        let options = core_1.resolveConfiguration(this.compilationOptions);
        let blockCompiler = new core_1.BlockCompiler(opticss_1.postcss, options);
        let numBlocks = 0;
        let optimizer = new opticss_2.Optimizer(this.optimizationOptions, analyzer.optimizationOptions);
        let blocks = analyzer.transitiveBlockDependencies();
        for (let block of blocks) {
            if (block.stylesheet && block.identifier) {
                blocks.add(block);
                this.trace(`compiling ${block.identifier}.`);
                let root = blockCompiler.compile(block, block.stylesheet, analyzer);
                let result = root.toResult({ to: cssOutputName, map: { inline: false, annotation: false } });
                // TODO: handle a sourcemap from compiling the block file via a preprocessor.
                let filename = options.importer.filesystemPath(block.identifier, options) || options.importer.debugIdentifier(block.identifier, options);
                optimizer.addSource({
                    content: result.css,
                    filename,
                    sourceMap: result.map.toJSON(),
                });
                numBlocks++;
            }
        }
        let analyses = analyzer.analyses();
        for (let a of analyses) {
            this.trace(`Adding analysis for ${a.template.identifier} to optimizer.`);
            this.trace(`Analysis for ${a.template.identifier} has ${a.elementCount()} elements.`);
            optimizer.addAnalysis(a.forOptimizer(options));
        }
        this.trace(`compiled ${numBlocks} blocks.`);
        this.debug("optimization starting.");
        return optimizer.optimize(cssOutputName).then(optimizationResult => {
            this.debug("optimization complete.");
            return {
                optimizationResult,
                blocks,
                analyses,
            };
        });
    }
    trace(message) {
        message = message.replace(this.projectDir + "/", "");
        this.debug(`[${this.name}] ${message}`);
    }
    /**
     * Fires when the compilation promise is available.
     */
    onPendingCompilation(handler) {
        this.plugin("block-compilation-pending", handler);
    }
    notifyPendingCompilation(pendingResult) {
        this.applyPlugins("block-compilation-pending", pendingResult);
    }
    /**
     * Fires when the compilation is first started to let any listeners know that
     * their current promise is no longer valid.
     */
    onCompilationExpiration(handler) {
        this.plugin("block-compilation-expired", handler);
    }
    notifyCompilationExpiration() {
        this.applyPlugins("block-compilation-expired");
    }
    /**
     * Fires when the compilation is done.
     */
    onComplete(handler) {
        this.plugin("block-compilation-complete", handler);
    }
    notifyComplete(result, cb) {
        this.applyPluginsAsync("block-compilation-complete", result, cb);
    }
}
exports.CssBlocksPlugin = CssBlocksPlugin;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUGx1Z2luLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL1BsdWdpbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7O0FBQ0Esd0NBQXdFO0FBQ3hFLHdDQUF3QztBQUN4QyxxQ0FBa0M7QUFDbEMsNkJBQTZCO0FBRTdCLG1DQUFtQztBQUVuQyxxREFBcUU7QUFFckUsMkNBUTBCO0FBQzFCLHFDQU1pQjtBQWlEakIsTUFBYSxlQUNYLFNBQVEsT0FBTztJQVlmLFlBQVksT0FBZ0M7UUFDMUMsS0FBSyxFQUFFLENBQUM7UUFFUixJQUFJLENBQUMsS0FBSyxHQUFHLGNBQWMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO1FBQ2xELElBQUksQ0FBQyxRQUFRLEdBQUcsT0FBTyxDQUFDLFFBQVEsQ0FBQztRQUNqQyxJQUFJLENBQUMsYUFBYSxHQUFHLE9BQU8sQ0FBQyxhQUFhLElBQUksZ0JBQWdCLENBQUM7UUFDL0QsSUFBSSxDQUFDLElBQUksR0FBRyxPQUFPLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUM7UUFDL0MsSUFBSSxDQUFDLGtCQUFrQixHQUFHLE9BQU8sQ0FBQyxrQkFBa0IsSUFBSSxFQUFFLENBQUM7UUFDM0QsSUFBSSxDQUFDLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDaEMsSUFBSSxDQUFDLG1CQUFtQixHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxFQUFFLHlCQUFlLEVBQUUsT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQ3RGLENBQUM7SUFFYSxVQUFVLENBQUMsVUFBa0IsRUFBRSxNQUFjLEVBQUUsV0FBdUIsRUFBRSxFQUEyQjs7WUFDL0csOENBQThDO1lBQzlDLElBQUksQ0FBQyxLQUFLLENBQUMsb0JBQW9CLENBQUMsQ0FBQztZQUNqQyxJQUFJLENBQUMsUUFBUSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBRXRCLGdDQUFnQztZQUNoQyxJQUFJLFlBQVks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QUksQ0FBQyxNQUFNLENBQUMsNEJBQTRCLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDckQsQ0FBQztJQUNPLGNBQWMsQ0FBQyxNQUF3RCxFQUFFLEVBQXdCO1FBQ3ZHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyw0QkFBNEIsRUFBRSxNQUFNLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDbkUsQ0FBQztDQUNGO0FBNVBELDBDQTRQQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFRlbXBsYXRlVHlwZXMgfSBmcm9tIFwiQG9wdGljc3MvdGVtcGxhdGUtYXBpXCI7XG5pbXBvcnQgeyBPYmplY3REaWN0aW9uYXJ5LCBmbGF0dGVuLCBvYmplY3RWYWx1ZXMgfSBmcm9tIFwiQG9wdGljc3MvdXRpbFwiO1xuaW1wb3J0ICogYXMgZGVidWdHZW5lcmF0b3IgZnJvbSBcImRlYnVnXCI7XG5pbXBvcnQgeyBwb3N0Y3NzIH0gZnJvbSBcIm9wdGljc3NcIjtcbmltcG9ydCAqIGFzIHBhdGggZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IFJhd1NvdXJjZU1hcCB9IGZyb20gXCJzb3VyY2UtbWFwXCI7XG5pbXBvcnQgKiBhcyBUYXBhYmxlIGZyb20gXCJ0YXBhYmxlXCI7XG5pbXBvcnQgeyBDb21waWxlciBhcyBXZWJwYWNrQ29tcGlsZXIsIFBsdWdpbiBhcyBXZWJwYWNrUGx1Z2luIH0gZnJvbSBcIndlYnBhY2tcIjtcbmltcG9ydCB7IFJhd1NvdXJjZSwgU291cmNlLCBTb3VyY2VNYXBTb3VyY2UgfSBmcm9tIFwid2VicGFjay1zb3VyY2VzXCI7XG5cbmltcG9ydCB7XG4gIEFuYWx5c2lzLFxuICBBbmFseXplciBhcyBBbmFseXplclR5cGUsXG4gIEJsb2NrLFxuICBCbG9ja0NvbXBpbGVyLFxuICBPcHRpb25zIGFzIENTU0Jsb2Nrc09wdGlvbnMsXG4gIFN0eWxlTWFwcGluZyxcbiAgcmVzb2x2ZUNvbmZpZ3VyYXRpb24sXG59IGZyb20gXCJAY3NzLWJsb2Nrcy9jb3JlXCI7XG5pbXBvcnQge1xuICBBY3Rpb25zLFxuICBERUZBVUxUX09QVElPTlMsXG4gIE9wdGlDU1NPcHRpb25zLFxuICBPcHRpbWl6YXRpb25SZXN1bHQsXG4gIE9wdGltaXplcixcbn0gZnJvbSBcIm9wdGljc3NcIjtcblxuaW1wb3J0IHsgTG9hZGVyQ29udGV4dCB9IGZyb20gXCIuL2NvbnRleHRcIjtcblxuZXhwb3J0IHR5cGUgVG1wVHlwZSA9IGtleW9mIFRlbXBsYXRlVHlwZXM7XG5leHBvcnQgdHlwZSBBbmFseXplciA9IEFuYWx5emVyVHlwZTxUbXBUeXBlPjtcbmV4cG9ydCB0eXBlIFBlbmRpbmdSZXN1bHQgPSBQcm9taXNlPFN0eWxlTWFwcGluZzxUbXBUeXBlPiB8IHZvaWQ+O1xuXG5leHBvcnQgaW50ZXJmYWNlIENzc0Jsb2Nrc1dlYnBhY2tPcHRpb25zIHtcbiAgLy8vIFRoZSBuYW1lIG9mIHRoZSBpbnN0YW5jZSBvZiB0aGUgcGx1Z2luLiBEZWZhdWx0cyB0byBvdXRwdXRDc3NGaWxlLlxuICBuYW1lPzogc3RyaW5nO1xuICAvLy8gVGhlIGFuYWx5emVyIHRoYXQgZGVjaWRlcyB3aGF0IHRlbXBsYXRlcyBhcmUgYW5hbHl6ZWQgYW5kIHdoYXQgYmxvY2tzIHdpbGwgYmUgY29tcGlsZWQuXG4gIGFuYWx5emVyOiBBbmFseXplcjtcbiAgLy8vIFRoZSBvdXRwdXQgY3NzIGZpbGUgZm9yIGFsbCBjb21waWxlZCBDU1MgQmxvY2tzLiBEZWZhdWx0cyB0byBcImNzcy1ibG9ja3MuY3NzXCJcbiAgb3V0cHV0Q3NzRmlsZT86IHN0cmluZztcbiAgLy8vIENvbXBpbGF0aW9uIG9wdGlvbnMgcGFzcyB0byBjc3MtYmxvY2tzXG4gIGNvbXBpbGF0aW9uT3B0aW9ucz86IENTU0Jsb2Nrc09wdGlvbnM7XG4gIC8vLyBPcHRpbWl6YXRpb24gb3B0aW9ucyBwYXNzZWQgdG8gb3B0aWNzc1xuICBvcHRpbWl6YXRpb24/OiBPcHRpQ1NTT3B0aW9ucztcbn1cblxuLy8gdGhlcmUncyBub3QgYW55IGdvb2QgdHlwZXMgZm9yIHdlYnBhY2sncyBpbnRlcm5hbHMuXG4vLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6cHJlZmVyLXdoYXRldmVyLXRvLWFueVxuZXhwb3J0IHR5cGUgV2VicGFja0FueSA9IGFueTtcblxuZXhwb3J0IGludGVyZmFjZSBCbG9ja0NvbXBpbGF0aW9uRXJyb3Ige1xuICBjb21waWxhdGlvbjogV2VicGFja0FueTtcbiAgYXNzZXRQYXRoOiBzdHJpbmc7XG4gIGVycm9yOiBFcnJvcjtcbiAgbWFwcGluZz86IFN0eWxlTWFwcGluZzxUbXBUeXBlPjtcbiAgb3B0aW1pemVyQWN0aW9ucz86IEFjdGlvbnM7XG59XG5leHBvcnQgaW50ZXJmYWNlIEJsb2NrQ29tcGlsYXRpb25Db21wbGV0ZSB7XG4gIGNvbXBpbGF0aW9uOiBXZWJwYWNrQW55O1xuICBhc3NldFBhdGg6IHN0cmluZztcbiAgbWFwcGluZzogU3R5bGVNYXBwaW5nPFRtcFR5cGU+O1xuICBvcHRpbWl6ZXJBY3Rpb25zOiBBY3Rpb25zO1xufVxuXG50eXBlIEFzc2V0cyA9IE9iamVjdERpY3Rpb25hcnk8U291cmNlPjtcblxudHlwZSBFbnRyeVR5cGVzID0gc3RyaW5nIHwgc3RyaW5nW10gfCBPYmplY3REaWN0aW9uYXJ5PHN0cmluZz47XG5cbmludGVyZmFjZSBDb21waWxhdGlvblJlc3VsdCB7XG4gIG9wdGltaXphdGlvblJlc3VsdDogT3B0aW1pemF0aW9uUmVzdWx0O1xuICBibG9ja3M6IFNldDxCbG9jaz47XG4gIGFuYWx5c2VzOiBBcnJheTxBbmFseXNpczxUbXBUeXBlPj47XG59XG5cbmV4cG9ydCBjbGFzcyBDc3NCbG9ja3NQbHVnaW5cbiAgZXh0ZW5kcyBUYXBhYmxlXG4gIGltcGxlbWVudHMgV2VicGFja1BsdWdpblxue1xuICBvcHRpbWl6YXRpb25PcHRpb25zOiBPcHRpQ1NTT3B0aW9ucztcbiAgbmFtZTogc3RyaW5nO1xuICBhbmFseXplcjogQW5hbHl6ZXI7XG4gIHByb2plY3REaXI6IHN0cmluZztcbiAgb3V0cHV0Q3NzRmlsZTogc3RyaW5nO1xuICBjb21waWxhdGlvbk9wdGlvbnM6IENTU0Jsb2Nrc09wdGlvbnM7XG4gIHBlbmRpbmdSZXN1bHQ/OiBQZW5kaW5nUmVzdWx0O1xuICBkZWJ1ZzogZGVidWdHZW5lcmF0b3IuSURlYnVnZ2VyO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IENzc0Jsb2Nrc1dlYnBhY2tPcHRpb25zKSB7XG4gICAgc3VwZXIoKTtcblxuICAgIHRoaXMuZGVidWcgPSBkZWJ1Z0dlbmVyYXRvcihcImNzcy1ibG9ja3M6d2VicGFja1wiKTtcbiAgICB0aGlzLmFuYWx5emVyID0gb3B0aW9ucy5hbmFseXplcjtcbiAgICB0aGlzLm91dHB1dENzc0ZpbGUgPSBvcHRpb25zLm91dHB1dENzc0ZpbGUgfHwgXCJjc3MtYmxvY2tzLmNzc1wiO1xuICAgIHRoaXMubmFtZSA9IG9wdGlvbnMubmFtZSB8fCB0aGlzLm91dHB1dENzc0ZpbGU7XG4gICAgdGhpcy5jb21waWxhdGlvbk9wdGlvbnMgPSBvcHRpb25zLmNvbXBpbGF0aW9uT3B0aW9ucyB8fCB7fTtcbiAgICB0aGlzLnByb2plY3REaXIgPSBwcm9jZXNzLmN3ZCgpO1xuICAgIHRoaXMub3B0aW1pemF0aW9uT3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfT1BUSU9OUywgb3B0aW9ucy5vcHRpbWl6YXRpb24pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVNYWtlKG91dHB1dFBhdGg6IHN0cmluZywgYXNzZXRzOiBBc3NldHMsIGNvbXBpbGF0aW9uOiBXZWJwYWNrQW55LCBjYjogKGVycm9yPzogRXJyb3IpID0+IHZvaWQpIHtcbiAgICAvLyBTdGFydCBhbmFseXNpcyB3aXRoIGEgY2xlYW4gYW5hbHlzaXMgb2JqZWN0XG4gICAgdGhpcy50cmFjZShgc3RhcnRpbmcgYW5hbHlzaXMuYCk7XG4gICAgdGhpcy5hbmFseXplci5yZXNldCgpO1xuXG4gICAgLy8gRmV0Y2ggb3VyIGFwcCdzIGVudHJ5IHBvaW50cy5cbiAgICBsZXQgd2VicGFja0VudHJ5ID0gY29tcGlsYXRpb24ub3B0aW9ucy5lbnRyeSBhcyBFbnRyeVR5cGVzO1xuICAgIGxldCBlbnRyaWVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgLy8gWm9tZyB3ZWJwYWNrLCBzbyBtYW55IGNvbmZpZyBmb3JtYXQgb3B0aW9ucy5cbiAgICBpZiAodHlwZW9mIHdlYnBhY2tFbnRyeSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgZW50cmllcyA9IFsgd2VicGFja0VudHJ5IF07XG4gICAgfVxuICAgIGVsc2UgaWYgKEFycmF5LmlzQXJyYXkod2VicGFja0VudHJ5KSkge1xuICAgICAgZW50cmllcyA9IHdlYnBhY2tFbnRyeTtcbiAgICB9XG4gICAgZWxzZSBpZiAodHlwZW9mIHdlYnBhY2tFbnRyeSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgZW50cmllcyA9IGZsYXR0ZW4ob2JqZWN0VmFsdWVzKHdlYnBhY2tFbnRyeSkpO1xuICAgIH1cblxuICAgIC8vIFpvbWcgd2VicGFjay1kZXYtc2VydmVyLCBpbmplY3RpbmcgZmFrZSBwYXRocyBpbnRvIHRoZSBlbnRyeSBwb2ludHMuXG4gICAgZW50cmllcyA9IGVudHJpZXMuZmlsdGVyKGVudHJ5ID0+ICEvXFwvd2VicGFjay1kZXYtc2VydmVyXFwvfF53ZWJwYWNrXFwvaG90XFwvZGV2LXNlcnZlciQvLnRlc3QoZW50cnkpKTtcblxuICAgIGxldCBwZW5kaW5nOiBQZW5kaW5nUmVzdWx0ID0gdGhpcy5hbmFseXplci5hbmFseXplKFwiXCIsIGVudHJpZXMpXG4gICAgICAvLyBJZiBhbmFseXNpcyBmYWlscywgZHJhaW4gb3VyIEJsb2NrRmFjdG9yeSwgYWRkIGVycm9yIHRvIGNvbXBpbGF0aW9uIGVycm9yIGxpc3QgYW5kIHByb3BhZ2F0ZS5cbiAgICAgIC5jYXRjaCgoZXJyOiBFcnJvcikgPT4ge1xuICAgICAgICB0aGlzLnRyYWNlKGBFcnJvciBkdXJpbmcgYW5hbHlzaXMuIERyYWluaW5nIHF1ZXVlLmApO1xuICAgICAgICByZXR1cm4gdGhpcy5hbmFseXplci5ibG9ja0ZhY3RvcnkucHJlcGFyZUZvckV4aXQoKS50aGVuKCgpID0+IHtcbiAgICAgICAgICB0aGlzLnRyYWNlKGBEcmFpbmVkLiBSYWlzaW5nIGVycm9yLmApO1xuICAgICAgICAgIHRocm93IGVycjsgLy8gV2UncmUgZG9uZSwgdGhyb3cgdG8gc2tpcCB0aGUgcmVzdCBvZiB0aGUgcGx1Z2luIHN0ZXBzIGJlbG93LlxuICAgICAgICB9KTtcbiAgICAgIH0pXG5cbiAgICAgIC8vIElmIGFuYWx5c2lzIGZpbmlzaGVkIHN1Y2Nlc3NmdWxseSwgY29tcGlsZSBvdXIgYmxvY2tzIHRvIG91dHB1dC5cbiAgICAgIC50aGVuKChhbmFseXNpczogQW5hbHl6ZXIpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29tcGlsZUJsb2NrcyhhbmFseXNpcywgcGF0aC5qb2luKG91dHB1dFBhdGgsIHRoaXMub3V0cHV0Q3NzRmlsZSkpO1xuICAgICAgfSlcblxuICAgICAgLy8gQWRkIHRoZSByZXN1bHRpbmcgY3NzIG91dHB1dCB0byBvdXIgYnVpbGQuXG4gICAgICAudGhlbigocmVzdWx0OiBDb21waWxhdGlvblJlc3VsdCkgPT4ge1xuICAgICAgICB0aGlzLnRyYWNlKGBzZXR0aW5nIGNzcyBhc3NldDogJHt0aGlzLm91dHB1dENzc0ZpbGV9YCk7XG4gICAgICAgIGxldCBzb3VyY2U6IFNvdXJjZTtcbiAgICAgICAgaWYgKHJlc3VsdC5vcHRpbWl6YXRpb25SZXN1bHQub3V0cHV0LnNvdXJjZU1hcCkge1xuICAgICAgICAgIGxldCByZXN1bHRNYXAgPSByZXN1bHQub3B0aW1pemF0aW9uUmVzdWx0Lm91dHB1dC5zb3VyY2VNYXA7XG4gICAgICAgICAgbGV0IHJhd1NvdXJjZU1hcDogUmF3U291cmNlTWFwO1xuICAgICAgICAgIGlmICh0eXBlb2YgcmVzdWx0TWFwID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICByYXdTb3VyY2VNYXAgPSBKU09OLnBhcnNlKHJlc3VsdE1hcCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJhd1NvdXJjZU1hcCA9IHJlc3VsdE1hcDtcbiAgICAgICAgICB9XG4gICAgICAgICAgc291cmNlID0gbmV3IFNvdXJjZU1hcFNvdXJjZShcbiAgICAgICAgICAgIHJlc3VsdC5vcHRpbWl6YXRpb25SZXN1bHQub3V0cHV0LmNvbnRlbnQudG9TdHJpbmcoKSxcbiAgICAgICAgICAgIFwib3B0aW1pemVkIGNzc1wiLFxuICAgICAgICAgICAgcmF3U291cmNlTWFwKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBzb3VyY2UgPSBuZXcgUmF3U291cmNlKHJlc3VsdC5vcHRpbWl6YXRpb25SZXN1bHQub3V0cHV0LmNvbnRlbnQudG9TdHJpbmcoKSk7XG4gICAgICAgIH1cbiAgICAgICAgYXNzZXRzW2Ake3RoaXMub3V0cHV0Q3NzRmlsZX0ubG9nYF0gPSBuZXcgUmF3U291cmNlKHJlc3VsdC5vcHRpbWl6YXRpb25SZXN1bHQuYWN0aW9ucy5wZXJmb3JtZWQubWFwKGEgPT4gYS5sb2dTdHJpbmcoKSkuam9pbihcIlxcblwiKSk7XG4gICAgICAgIGFzc2V0c1t0aGlzLm91dHB1dENzc0ZpbGVdID0gc291cmNlO1xuICAgICAgICBsZXQgY29tcGxldGlvbjogQmxvY2tDb21waWxhdGlvbkNvbXBsZXRlID0ge1xuICAgICAgICAgIGNvbXBpbGF0aW9uOiBjb21waWxhdGlvbixcbiAgICAgICAgICBhc3NldFBhdGg6IHRoaXMub3V0cHV0Q3NzRmlsZSxcbiAgICAgICAgICBtYXBwaW5nOiBuZXcgU3R5bGVNYXBwaW5nKHJlc3VsdC5vcHRpbWl6YXRpb25SZXN1bHQuc3R5bGVNYXBwaW5nLCByZXN1bHQuYmxvY2tzLCByZXNvbHZlQ29uZmlndXJhdGlvbih0aGlzLmNvbXBpbGF0aW9uT3B0aW9ucyksIHJlc3VsdC5hbmFseXNlcyksXG4gICAgICAgICAgb3B0aW1pemVyQWN0aW9uczogcmVzdWx0Lm9wdGltaXphdGlvblJlc3VsdC5hY3Rpb25zLFxuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gY29tcGxldGlvbjtcbiAgICAgIH0pXG5cbiAgICAgIC8vIE5vdGlmeSB0aGUgd29ybGQgd2hlbiBjb21wbGV0ZS5cbiAgICAgIC50aGVuKChjb21wbGV0aW9uOiBCbG9ja0NvbXBpbGF0aW9uQ29tcGxldGUpID0+IHtcbiAgICAgICAgdGhpcy50cmFjZShgbm90aWZ5aW5nIG9mIGNvbXBsZXRpb25gKTtcbiAgICAgICAgdGhpcy5ub3RpZnlDb21wbGV0ZShjb21wbGV0aW9uLCBjYik7XG4gICAgICAgIHRoaXMudHJhY2UoYG5vdGlmaWVkIG9mIGNvbXBsZXRpb25gKTtcbiAgICAgICAgcmV0dXJuIGNvbXBsZXRpb247XG4gICAgICB9KVxuXG4gICAgICAvLyBSZXR1cm4ganVzdCB0aGUgbWFwcGluZyBvYmplY3QgZnJvbSB0aGlzIHByb21pc2UuXG4gICAgICAudGhlbigoY29tcGlsYXRpb25SZXN1bHQ6IEJsb2NrQ29tcGlsYXRpb25Db21wbGV0ZSk6IFN0eWxlTWFwcGluZzxUbXBUeXBlPiA9PiB7XG4gICAgICAgIHJldHVybiBjb21waWxhdGlvblJlc3VsdC5tYXBwaW5nO1xuICAgICAgfSlcblxuICAgICAgLy8gSWYgc29tZXRoaW5nIGJhZCBoYXBwZW5lZCwgbG9nIHRoZSBlcnJvciBhbmQgcHJldGVuZCBsaWtlIG5vdGhpbmcgaGFwcGVuZWRcbiAgICAgIC8vIGJ5IG5vdGlmeWluZyBkZXBzIG9mIGNvbXBsZXRpb24gYW5kIHJldHVybmluZyBhbiBlbXB0eSBNZXRhU3R5bGVNYXBwaW5nXG4gICAgICAvLyBzbyBjb21waWxhdGlvbiBjYW4gY29udGludWUuXG4gICAgICAuY2F0Y2goKGVycm9yOiBFcnJvcikgPT4ge1xuICAgICAgICB0aGlzLnRyYWNlKGBub3RpZnlpbmcgb2YgY29tcGlsYXRpb24gZmFpbHVyZWApO1xuICAgICAgICBjb21waWxhdGlvbi5lcnJvcnMucHVzaChlcnJvcik7XG4gICAgICAgIHRoaXMubm90aWZ5Q29tcGxldGUoXG4gICAgICAgICAge1xuICAgICAgICAgICAgZXJyb3IsXG4gICAgICAgICAgICBjb21waWxhdGlvbixcbiAgICAgICAgICAgIGFzc2V0UGF0aDogdGhpcy5vdXRwdXRDc3NGaWxlLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgY2IpO1xuICAgICAgICB0aGlzLnRyYWNlKGBub3RpZmllZCBvZiBjb21waWxhdGlvbiBmYWlsdXJlYCk7XG4gICAgICB9KTtcblxuICAgIHRoaXMudHJhY2UoYG5vdGlmeWluZyBvZiBwZW5kaW5nIGNvbXBpbGF0aW9uYCk7XG4gICAgdGhpcy5ub3RpZnlQZW5kaW5nQ29tcGlsYXRpb24ocGVuZGluZyk7XG4gICAgdGhpcy50cmFjZShgbm90aWZpZWQgb2YgcGVuZGluZyBjb21waWxhdGlvbmApO1xuICB9XG5cbiAgYXBwbHkoY29tcGlsZXI6IFdlYnBhY2tDb21waWxlcikge1xuICAgIHRoaXMucHJvamVjdERpciA9IGNvbXBpbGVyLm9wdGlvbnMuY29udGV4dCB8fCB0aGlzLnByb2plY3REaXI7XG4gICAgbGV0IG91dHB1dFBhdGggPSBjb21waWxlci5vcHRpb25zLm91dHB1dCAmJiBjb21waWxlci5vcHRpb25zLm91dHB1dC5wYXRoIHx8IHRoaXMucHJvamVjdERpcjsgLy8gVE9ETyBXaGF0IGlzIHRoZSB3ZWJwYWNrIGRlZmF1bHQgb3V0cHV0IGRpcmVjdG9yeT9cbiAgICBsZXQgYXNzZXRzOiBBc3NldHMgPSB7fTtcblxuICAgIGNvbXBpbGVyLnBsdWdpbihcInRoaXMtY29tcGlsYXRpb25cIiwgKGNvbXBpbGF0aW9uKSA9PiB7XG4gICAgICB0aGlzLm5vdGlmeUNvbXBpbGF0aW9uRXhwaXJhdGlvbigpO1xuXG4gICAgICBjb21waWxhdGlvbi5wbHVnaW4oXCJhZGRpdGlvbmFsLWFzc2V0c1wiLCAoY2I6ICgpID0+IHZvaWQpID0+IHtcbiAgICAgICAgT2JqZWN0LmFzc2lnbihjb21waWxhdGlvbi5hc3NldHMsIGFzc2V0cyk7XG4gICAgICAgIGNiKCk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGNvbXBpbGVyLnBsdWdpbihcIm1ha2VcIiwgdGhpcy5oYW5kbGVNYWtlLmJpbmQodGhpcywgb3V0cHV0UGF0aCwgYXNzZXRzKSk7XG5cbiAgICAvLyBPbmNlIHdlJ3JlIGRvbmUsIGFkZCBhbGwgZGlzY292ZXJlZCBibG9jayBmaWxlcyB0byB0aGUgYnVpbGQgZGVwZW5kZW5jaWVzXG4gICAgLy8gc28gdGhpcyBwbHVnaW4gaXMgcmUtZXZhbHVhdGVkIHdoZW4gdGhleSBjaGFuZ2UuXG4gICAgLy8gVE9ETzogV2UgZ2V0IHRpbWVzdGFtcCBkYXRhIGhlcmUuIFdlIGNhbiBwcm9iYWJseSBpbnRlbGxpZ2VudGx5IHJlLWJ1aWxkLlxuICAgIGNvbXBpbGVyLnBsdWdpbihcImVtaXRcIiwgKGNvbXBpbGF0aW9uLCBjYWxsYmFjaykgPT4ge1xuICAgICAgbGV0IGRpc2NvdmVyZWRGaWxlcyA9IFsuLi50aGlzLmFuYWx5emVyLnRyYW5zaXRpdmVCbG9ja0RlcGVuZGVuY2llcygpXS5tYXAoKGIpID0+IGIuaWRlbnRpZmllcik7XG4gICAgICBjb21waWxhdGlvbi5maWxlRGVwZW5kZW5jaWVzLnB1c2goLi4uZGlzY292ZXJlZEZpbGVzKTtcbiAgICAgIGNhbGxiYWNrKCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLm9uQ29tcGlsYXRpb25FeHBpcmF0aW9uKCgpID0+IHtcbiAgICAgIHRoaXMudHJhY2UoYHJlc2V0dGluZyBwZW5kaW5nIGNvbXBpbGF0aW9uLmApO1xuICAgICAgdGhpcy5wZW5kaW5nUmVzdWx0ID0gdW5kZWZpbmVkO1xuICAgIH0pO1xuXG4gICAgdGhpcy5vblBlbmRpbmdDb21waWxhdGlvbigocGVuZGluZ1Jlc3VsdCkgPT4ge1xuICAgICAgdGhpcy50cmFjZShgcmVjZWl2ZWQgcGVuZGluZyBjb21waWxhdGlvbi5gKTtcbiAgICAgIHRoaXMucGVuZGluZ1Jlc3VsdCA9IHBlbmRpbmdSZXN1bHQ7XG4gICAgfSk7XG5cbiAgICBjb21waWxlci5wbHVnaW4oXCJjb21waWxhdGlvblwiLCAoY29tcGlsYXRpb246IFdlYnBhY2tBbnkpID0+IHtcbiAgICAgIGNvbXBpbGF0aW9uLnBsdWdpbihcIm5vcm1hbC1tb2R1bGUtbG9hZGVyXCIsIChjb250ZXh0OiBMb2FkZXJDb250ZXh0LCBtb2Q6IFdlYnBhY2tBbnkpID0+IHtcbiAgICAgICAgdGhpcy50cmFjZShgcHJlcGFyaW5nIG5vcm1hbC1tb2R1bGUtbG9hZGVyIGZvciAke21vZC5yZXNvdXJjZX1gKTtcbiAgICAgICAgY29udGV4dC5jc3NCbG9ja3MgPSBjb250ZXh0LmNzc0Jsb2NrcyB8fCB7IG1hcHBpbmdzOiB7fSwgY29tcGlsYXRpb25PcHRpb25zOiB0aGlzLmNvbXBpbGF0aW9uT3B0aW9ucyB9O1xuXG4gICAgICAgIC8vIElmIHdlJ3JlIGFscmVhZHkgd2FpdGluZyBmb3IgYSBjc3MgZmlsZSBvZiB0aGlzIG5hbWUgdG8gZmluaXNoIGNvbXBpbGluZywgdGhyb3cuXG4gICAgICAgIGlmIChjb250ZXh0LmNzc0Jsb2Nrcy5tYXBwaW5nc1t0aGlzLm91dHB1dENzc0ZpbGVdKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBjc3MgY29uZmxpY3QgZGV0ZWN0ZWQuIE11bHRpcGxlIGNvbXBpbGVzIHdyaXRpbmcgdG8gJHt0aGlzLm91dHB1dENzc0ZpbGV9P2ApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMucGVuZGluZ1Jlc3VsdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBwZW5kaW5nIHJlc3VsdCBpcyBhdmFpbGFibGUgeWV0LmApO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRleHQuY3NzQmxvY2tzLm1hcHBpbmdzW3RoaXMub3V0cHV0Q3NzRmlsZV0gPSB0aGlzLnBlbmRpbmdSZXN1bHQ7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICB9XG5cbiAgcHJpdmF0ZSBjb21waWxlQmxvY2tzKGFuYWx5emVyOiBBbmFseXplciwgY3NzT3V0cHV0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxDb21waWxhdGlvblJlc3VsdD4ge1xuICAgIGxldCBvcHRpb25zID0gcmVzb2x2ZUNvbmZpZ3VyYXRpb24odGhpcy5jb21waWxhdGlvbk9wdGlvbnMpO1xuICAgIGxldCBibG9ja0NvbXBpbGVyID0gbmV3IEJsb2NrQ29tcGlsZXIocG9zdGNzcywgb3B0aW9ucyk7XG4gICAgbGV0IG51bUJsb2NrcyA9IDA7XG4gICAgbGV0IG9wdGltaXplciA9IG5ldyBPcHRpbWl6ZXIodGhpcy5vcHRpbWl6YXRpb25PcHRpb25zLCBhbmFseXplci5vcHRpbWl6YXRpb25PcHRpb25zKTtcbiAgICBsZXQgYmxvY2tzID0gYW5hbHl6ZXIudHJhbnNpdGl2ZUJsb2NrRGVwZW5kZW5jaWVzKCk7XG4gICAgZm9yIChsZXQgYmxvY2sgb2YgYmxvY2tzKSB7XG4gICAgICBpZiAoYmxvY2suc3R5bGVzaGVldCAmJiBibG9jay5pZGVudGlmaWVyKSB7XG4gICAgICAgIGJsb2Nrcy5hZGQoYmxvY2spO1xuICAgICAgICB0aGlzLnRyYWNlKGBjb21waWxpbmcgJHtibG9jay5pZGVudGlmaWVyfS5gKTtcbiAgICAgICAgbGV0IHJvb3QgPSBibG9ja0NvbXBpbGVyLmNvbXBpbGUoYmxvY2ssIGJsb2NrLnN0eWxlc2hlZXQsIGFuYWx5emVyKTtcbiAgICAgICAgbGV0IHJlc3VsdCA9IHJvb3QudG9SZXN1bHQoe3RvOiBjc3NPdXRwdXROYW1lLCBtYXA6IHsgaW5saW5lOiBmYWxzZSwgYW5ub3RhdGlvbjogZmFsc2UgfX0pO1xuICAgICAgICAvLyBUT0RPOiBoYW5kbGUgYSBzb3VyY2VtYXAgZnJvbSBjb21waWxpbmcgdGhlIGJsb2NrIGZpbGUgdmlhIGEgcHJlcHJvY2Vzc29yLlxuICAgICAgICBsZXQgZmlsZW5hbWUgPSBvcHRpb25zLmltcG9ydGVyLmZpbGVzeXN0ZW1QYXRoKGJsb2NrLmlkZW50aWZpZXIsIG9wdGlvbnMpIHx8IG9wdGlvbnMuaW1wb3J0ZXIuZGVidWdJZGVudGlmaWVyKGJsb2NrLmlkZW50aWZpZXIsIG9wdGlvbnMpO1xuICAgICAgICBvcHRpbWl6ZXIuYWRkU291cmNlKHtcbiAgICAgICAgICBjb250ZW50OiByZXN1bHQuY3NzLFxuICAgICAgICAgIGZpbGVuYW1lLFxuICAgICAgICAgIHNvdXJjZU1hcDogcmVzdWx0Lm1hcC50b0pTT04oKSxcbiAgICAgICAgfSk7XG4gICAgICAgIG51bUJsb2NrcysrO1xuICAgICAgfVxuICAgIH1cbiAgICBsZXQgYW5hbHlzZXMgPSBhbmFseXplci5hbmFseXNlcygpO1xuICAgIGZvciAobGV0IGEgb2YgYW5hbHlzZXMpIHtcbiAgICAgIHRoaXMudHJhY2UoYEFkZGluZyBhbmFseXNpcyBmb3IgJHthLnRlbXBsYXRlLmlkZW50aWZpZXJ9IHRvIG9wdGltaXplci5gKTtcbiAgICAgIHRoaXMudHJhY2UoYEFuYWx5c2lzIGZvciAke2EudGVtcGxhdGUuaWRlbnRpZmllcn0gaGFzICR7YS5lbGVtZW50Q291bnQoKX0gZWxlbWVudHMuYCk7XG4gICAgICBvcHRpbWl6ZXIuYWRkQW5hbHlzaXMoYS5mb3JPcHRpbWl6ZXIob3B0aW9ucykpO1xuICAgIH1cbiAgICB0aGlzLnRyYWNlKGBjb21waWxlZCAke251bUJsb2Nrc30gYmxvY2tzLmApO1xuICAgIHRoaXMuZGVidWcoXCJvcHRpbWl6YXRpb24gc3RhcnRpbmcuXCIpO1xuICAgIHJldHVybiBvcHRpbWl6ZXIub3B0aW1pemUoY3NzT3V0cHV0TmFtZSkudGhlbihvcHRpbWl6YXRpb25SZXN1bHQgPT4ge1xuICAgICAgdGhpcy5kZWJ1ZyhcIm9wdGltaXphdGlvbiBjb21wbGV0ZS5cIik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBvcHRpbWl6YXRpb25SZXN1bHQsXG4gICAgICAgIGJsb2NrcyxcbiAgICAgICAgYW5hbHlzZXMsXG4gICAgICB9O1xuICAgIH0pO1xuICB9XG4gIHRyYWNlKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIG1lc3NhZ2UgPSBtZXNzYWdlLnJlcGxhY2UodGhpcy5wcm9qZWN0RGlyICsgXCIvXCIsIFwiXCIpO1xuICAgIHRoaXMuZGVidWcoYFske3RoaXMubmFtZX1dICR7bWVzc2FnZX1gKTtcbiAgfVxuICAvKipcbiAgICogRmlyZXMgd2hlbiB0aGUgY29tcGlsYXRpb24gcHJvbWlzZSBpcyBhdmFpbGFibGUuXG4gICAqL1xuICBvblBlbmRpbmdDb21waWxhdGlvbihoYW5kbGVyOiAocGVuZGluZ1Jlc3VsdDogUGVuZGluZ1Jlc3VsdCkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMucGx1Z2luKFwiYmxvY2stY29tcGlsYXRpb24tcGVuZGluZ1wiLCBoYW5kbGVyKTtcbiAgfVxuICBwcml2YXRlIG5vdGlmeVBlbmRpbmdDb21waWxhdGlvbihwZW5kaW5nUmVzdWx0OiBQZW5kaW5nUmVzdWx0KTogdm9pZCB7XG4gICAgdGhpcy5hcHBseVBsdWdpbnMoXCJibG9jay1jb21waWxhdGlvbi1wZW5kaW5nXCIsIHBlbmRpbmdSZXN1bHQpO1xuICB9XG4gIC8qKlxuICAgKiBGaXJlcyB3aGVuIHRoZSBjb21waWxhdGlvbiBpcyBmaXJzdCBzdGFydGVkIHRvIGxldCBhbnkgbGlzdGVuZXJzIGtub3cgdGhhdFxuICAgKiB0aGVpciBjdXJyZW50IHByb21pc2UgaXMgbm8gbG9uZ2VyIHZhbGlkLlxuICAgKi9cbiAgb25Db21waWxhdGlvbkV4cGlyYXRpb24oaGFuZGxlcjogKCkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMucGx1Z2luKFwiYmxvY2stY29tcGlsYXRpb24tZXhwaXJlZFwiLCBoYW5kbGVyKTtcbiAgfVxuICBwcml2YXRlIG5vdGlmeUNvbXBpbGF0aW9uRXhwaXJhdGlvbigpOiB2b2lkIHtcbiAgICB0aGlzLmFwcGx5UGx1Z2lucyhcImJsb2NrLWNvbXBpbGF0aW9uLWV4cGlyZWRcIik7XG4gIH1cbiAgLyoqXG4gICAqIEZpcmVzIHdoZW4gdGhlIGNvbXBpbGF0aW9uIGlzIGRvbmUuXG4gICAqL1xuICBvbkNvbXBsZXRlKGhhbmRsZXI6IChyZXN1bHQ6IEJsb2NrQ29tcGlsYXRpb25Db21wbGV0ZSB8IEJsb2NrQ29tcGlsYXRpb25FcnJvciwgY2I6IChlcnI6IEVycm9yKSA9PiB2b2lkKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5wbHVnaW4oXCJibG9jay1jb21waWxhdGlvbi1jb21wbGV0ZVwiLCBoYW5kbGVyKTtcbiAgfVxuICBwcml2YXRlIG5vdGlmeUNvbXBsZXRlKHJlc3VsdDogQmxvY2tDb21waWxhdGlvbkNvbXBsZXRlIHwgQmxvY2tDb21waWxhdGlvbkVycm9yLCBjYjogKGVycjogRXJyb3IpID0+IHZvaWQpOiB2b2lkIHtcbiAgICB0aGlzLmFwcGx5UGx1Z2luc0FzeW5jKFwiYmxvY2stY29tcGlsYXRpb24tY29tcGxldGVcIiwgcmVzdWx0LCBjYik7XG4gIH1cbn1cbiJdfQ==
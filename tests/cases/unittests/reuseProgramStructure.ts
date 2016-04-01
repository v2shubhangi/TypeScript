/// <reference path="..\..\..\src\harness\external\mocha.d.ts" />
/// <reference path='..\..\..\src\harness\harness.ts' />
/// <reference path="..\..\..\src\harness\harnessLanguageService.ts" />

module ts {

    const enum ChangedPart {
        references = 1 << 0,
        importsAndExports = 1 << 1,
        program = 1 << 2
    }

    let newLine = "\r\n";

    interface SourceFileWithText extends SourceFile {
        sourceText?: SourceText;
    }

    interface NamedSourceText {
        name: string;
        text: SourceText
    }

    interface ProgramWithSourceTexts extends Program {
        sourceTexts?: NamedSourceText[];
    }

    class SourceText implements IScriptSnapshot {
        private fullText: string;

        constructor(private references: string,
            private importsAndExports: string,
            private program: string,
            private changedPart: ChangedPart = 0,
            private version = 0) {
        }

        static New(references: string, importsAndExports: string, program: string): SourceText {
            Debug.assert(references !== undefined);
            Debug.assert(importsAndExports !== undefined);
            Debug.assert(program !== undefined);
            return new SourceText(references + newLine, importsAndExports + newLine, program || "");
        }

        public getVersion(): number {
            return this.version;
        }

        public updateReferences(newReferences: string): SourceText {
            Debug.assert(newReferences !== undefined);
            return new SourceText(newReferences + newLine, this.importsAndExports, this.program, this.changedPart | ChangedPart.references, this.version + 1);
        }
        public updateImportsAndExports(newImportsAndExports: string): SourceText {
            Debug.assert(newImportsAndExports !== undefined);
            return new SourceText(this.references, newImportsAndExports + newLine, this.program, this.changedPart | ChangedPart.importsAndExports, this.version + 1);
        }
        public updateProgram(newProgram: string): SourceText {
            Debug.assert(newProgram !== undefined);
            return new SourceText(this.references, this.importsAndExports, newProgram, this.changedPart | ChangedPart.program, this.version + 1);
        }

        public getFullText() {
            return this.fullText || (this.fullText = this.references + this.importsAndExports + this.program);
        }

        public getText(start: number, end: number): string {
            return this.getFullText().substring(start, end);
        }

        getLength(): number {
            return this.getFullText().length;
        }

        getChangeRange(oldSnapshot: IScriptSnapshot): TextChangeRange {
            var oldText = <SourceText>oldSnapshot;
            var oldSpan: TextSpan;
            var newLength: number;
            switch (oldText.changedPart ^ this.changedPart) {
                case ChangedPart.references:
                    oldSpan = createTextSpan(0, oldText.references.length);
                    newLength = this.references.length;
                    break;
                case ChangedPart.importsAndExports:
                    oldSpan = createTextSpan(oldText.references.length, oldText.importsAndExports.length);
                    newLength = this.importsAndExports.length
                    break;
                case ChangedPart.program:
                    oldSpan = createTextSpan(oldText.references.length + oldText.importsAndExports.length, oldText.program.length);
                    newLength = this.program.length;
                    break;
                default:
                    Debug.assert(false, "Unexpected change");
            }

            return createTextChangeRange(oldSpan, newLength);
        }
    }

    function createTestCompilerHost(texts: NamedSourceText[], target: ScriptTarget): CompilerHost {
        let files: Map<SourceFileWithText> = {};
        for (let t of texts) {
            let file = <SourceFileWithText>createSourceFile(t.name, t.text.getFullText(), target);
            file.sourceText = t.text;
            files[t.name] = file;
        }
        
        return {
            getSourceFile(fileName): SourceFile {
                return files[fileName];
            },
            getDefaultLibFileName(): string {
                return "lib.d.ts"
            },
            writeFile(file, text) {
                throw new Error("NYI");
            },
            getCurrentDirectory(): string {
                return "";
            },
            getCanonicalFileName(fileName): string {
                return sys && sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase();
            },
            useCaseSensitiveFileNames(): boolean {
                return sys && sys.useCaseSensitiveFileNames;
            },
            getNewLine(): string {
                return sys ? sys.newLine : newLine;
            },
            fileExists: fileName => hasProperty(files, fileName),
            readFile: fileName => {
                let file = lookUp(files, fileName);
                return file && file.text;
            }
        }
    }

    function newProgram(texts: NamedSourceText[], rootNames: string[], options: CompilerOptions): Program {
        var host = createTestCompilerHost(texts, options.target);
        let program = <ProgramWithSourceTexts>createProgram(rootNames, options, host);
        program.sourceTexts = texts;
        return program;
    }

    function updateProgram(oldProgram: Program, rootNames: string[], options: CompilerOptions, updater: (files: NamedSourceText[]) => void) {
        var texts: NamedSourceText[] = (<ProgramWithSourceTexts>oldProgram).sourceTexts.slice(0);
        updater(texts);
        var host = createTestCompilerHost(texts, options.target);
        var program = <ProgramWithSourceTexts>createProgram(rootNames, options, host, oldProgram);
        program.sourceTexts = texts;
        return program;
    }

    function getSizeOfMap(map: Map<any>): number {
        let size = 0;
        for (let id in map) {
            if (hasProperty(map, id)) {
                size++;
            }
        }
        return size;
    }

    function checkResolvedModule(expected: ResolvedModule, actual: ResolvedModule): void {
        assert.isTrue(actual !== undefined);
        assert.isTrue(expected.resolvedFileName === actual.resolvedFileName, `'resolvedFileName': expected '${expected.resolvedFileName}' to be equal to '${actual.resolvedFileName}'`);
        assert.isTrue(expected.isExternalLibraryImport === actual.isExternalLibraryImport, `'isExternalLibraryImport': expected '${expected.isExternalLibraryImport}' to be equal to '${actual.isExternalLibraryImport}'`);
    }

    function checkResolvedTypeDirective(expected: ResolvedTypeReferenceDirective, actual: ResolvedTypeReferenceDirective): void {
        assert.isTrue(actual !== undefined);
        assert.isTrue(expected.resolvedFileName === actual.resolvedFileName, `'resolvedFileName': expected '${expected.resolvedFileName}' to be equal to '${actual.resolvedFileName}'`);
        assert.isTrue(expected.primary === actual.primary, `'primary': expected '${expected.primary}' to be equal to '${actual.primary}'`);
    }

    function checkCache<T>(caption: string, program: Program, fileName: string, expectedContent: Map<T>, getCache: (f: SourceFile) => Map<T>, entryChecker: (expected: T, original:T) => void): void {
        let file = program.getSourceFile(fileName);
        assert.isTrue(file !== undefined, `cannot find file ${fileName}`);
        const cache = getCache(file)
        if (expectedContent === undefined) {
            assert.isTrue(cache === undefined, `expected ${caption} to be undefined`);
        }
        else {
            assert.isTrue(cache !== undefined, `expected ${caption} to be set`);
            let actualCacheSize = getSizeOfMap(cache);
            let expectedSize = getSizeOfMap(expectedContent);
            assert.isTrue(actualCacheSize === expectedSize, `expected actual size: ${actualCacheSize} to be equal to ${expectedSize}`);

            for (let id in expectedContent) {
                if (hasProperty(expectedContent, id)) {

                    if (expectedContent[id]) {
                        const expected = expectedContent[id];
                        const actual = cache[id];
                        entryChecker(expected, actual);
                    }
                }
                else {
                    assert.isTrue(cache[id] === undefined);
                }
            }
        }
    }

    function checkResolvedModulesCache(program: Program, fileName: string, expectedContent: Map<ResolvedModule>): void {
        checkCache("resolved modules", program, fileName, expectedContent, f => f.resolvedModules, checkResolvedModule);
    }

    function checkResolvedTypeDirectivesCache(program: Program, fileName: string, expectedContent: Map<ResolvedTypeReferenceDirective>): void {
        checkCache("resolved type directives", program, fileName, expectedContent, f => f.resolvedTypeDirectiveNames, checkResolvedTypeDirective);
    }

    describe("Reuse program structure", () => {
        let target = ScriptTarget.Latest;
        let files = [
            { name: "a.ts", text: SourceText.New(
                `
/// <reference path='b.ts'/>
/// <reference path='non-existing-file.ts'/>
/// <reference types="typerefs" />
`, "",`var x = 1`) },
            { name: "b.ts", text: SourceText.New(`/// <reference path='c.ts'/>`, "", `var y = 2`) },
            { name: "c.ts", text: SourceText.New("", "", `var z = 1;`) },
            { name: "types/typerefs/index.d.ts", text: SourceText.New("", "", `declare let z: number;`) },
        ]

        it("successful if change does not affect imports", () => {
            var program_1 = newProgram(files, ["a.ts"], { target });
            var program_2 = updateProgram(program_1, ["a.ts"], { target }, files => {
                files[0].text = files[0].text.updateProgram("var x = 100");
            });
            assert.isTrue(program_1.structureIsReused);
            let program1Diagnostics = program_1.getSemanticDiagnostics(program_1.getSourceFile("a.ts"))
            let program2Diagnostics = program_2.getSemanticDiagnostics(program_1.getSourceFile("a.ts"))
            assert.equal(program1Diagnostics.length, program2Diagnostics.length);
        });

        it("successful if change does not affect type reference directives", () => {
            var program_1 = newProgram(files, ["a.ts"], { target });
            var program_2 = updateProgram(program_1, ["a.ts"], { target }, files => {
                files[0].text = files[0].text.updateProgram("var x = 100");
            });
            assert.isTrue(program_1.structureIsReused);
            let program1Diagnostics = program_1.getSemanticDiagnostics(program_1.getSourceFile("a.ts"))
            let program2Diagnostics = program_2.getSemanticDiagnostics(program_1.getSourceFile("a.ts"))
            assert.equal(program1Diagnostics.length, program2Diagnostics.length);
        });

        it("fails if change affects tripleslash references", () => {
            var program_1 = newProgram(files, ["a.ts"], { target });
            var program_2 = updateProgram(program_1, ["a.ts"], { target }, files => {
                let newReferences = `/// <reference path='b.ts'/>
                /// <reference path='c.ts'/>
                `;
                files[0].text = files[0].text.updateReferences(newReferences);
            });
            assert.isTrue(!program_1.structureIsReused);
        });

        it("fails if change affects imports", () => {
            var program_1 = newProgram(files, ["a.ts"], { target });
            var program_2 = updateProgram(program_1, ["a.ts"], { target }, files => {
                files[2].text = files[2].text.updateImportsAndExports("import x from 'b'");
            });
            assert.isTrue(!program_1.structureIsReused);
        });

        it("fails if change affects type directives", () => {
            var program_1 = newProgram(files, ["a.ts"], { target });
            var program_2 = updateProgram(program_1, ["a.ts"], { target }, files => {
                let newReferences = `
/// <reference path='b.ts'/>
/// <reference path='non-existing-file.ts'/>
/// <reference types="typerefs1" />`;
                files[0].text = files[0].text.updateReferences(newReferences);
            });
            assert.isTrue(!program_1.structureIsReused);
        });

        it("fails if module kind changes", () => {
            var program_1 = newProgram(files, ["a.ts"], { target, module: ModuleKind.CommonJS });
            var program_2 = updateProgram(program_1, ["a.ts"], { target, module: ModuleKind.AMD }, files => void 0);
            assert.isTrue(!program_1.structureIsReused);
        });
        
        it("fails if rootdir changes", () => {
            var program_1 = newProgram(files, ["a.ts"], { target, module: ModuleKind.CommonJS, rootDir: "/a/b" });
            var program_2 = updateProgram(program_1, ["a.ts"], { target, module: ModuleKind.CommonJS, rootDir: "/a/c" }, files => void 0);
            assert.isTrue(!program_1.structureIsReused);
        });

        it("fails if config path changes", () => {
            var program_1 = newProgram(files, ["a.ts"], { target, module: ModuleKind.CommonJS, configFilePath: "/a/b/tsconfig.json" });
            var program_2 = updateProgram(program_1, ["a.ts"], { target, module: ModuleKind.CommonJS, configFilePath: "/a/c/tsconfig.json" }, files => void 0);
            assert.isTrue(!program_1.structureIsReused);
        });

        it("resolution cache follows imports", () => {
            let files = [
                { name: "a.ts", text: SourceText.New("", "import {_} from 'b'", "var x = 1") },
                { name: "b.ts", text: SourceText.New("", "", "var y = 2") },
            ];
            var options: CompilerOptions = { target };

            var program_1 = newProgram(files, ["a.ts"], options);
            checkResolvedModulesCache(program_1, "a.ts", { "b": { resolvedFileName: "b.ts" } });
            checkResolvedModulesCache(program_1, "b.ts", undefined);

            var program_2 = updateProgram(program_1, ["a.ts"], options, files => {
                files[0].text = files[0].text.updateProgram("var x = 2");
            });
            assert.isTrue(program_1.structureIsReused);

            // content of resolution cache should not change
            checkResolvedModulesCache(program_1, "a.ts", { "b": { resolvedFileName: "b.ts" } });
            checkResolvedModulesCache(program_1, "b.ts", undefined);

            // imports has changed - program is not reused
            var program_3 = updateProgram(program_2, ["a.ts"], options, files => {
                files[0].text = files[0].text.updateImportsAndExports("");
            });
            assert.isTrue(!program_2.structureIsReused);
            checkResolvedModulesCache(program_3, "a.ts", undefined);

            var program_4 = updateProgram(program_3, ["a.ts"], options, files => {
                let newImports = `import x from 'b'
                import y from 'c'
                `;
                files[0].text = files[0].text.updateImportsAndExports(newImports);
            });
            assert.isTrue(!program_3.structureIsReused);
            checkResolvedModulesCache(program_4, "a.ts", { "b": { resolvedFileName: "b.ts" }, "c": undefined });
        });

        it("resolved type directives cache follows type directives", () => {
            let files = [
                { name: "a.ts", text: SourceText.New("/// <reference types='typedefs'/>", "", "var x = $") },
                { name: "types/typedefs/index.d.ts", text: SourceText.New("", "", "declare var $: number") },
            ];
            var options: CompilerOptions = { target };

            var program_1 = newProgram(files, ["a.ts"], options);
            checkResolvedTypeDirectivesCache(program_1, "a.ts", { "typedefs": { resolvedFileName: "types/typedefs/index.d.ts", primary: true } });
            checkResolvedTypeDirectivesCache(program_1, "types/typedefs/index.d.ts", undefined);

            var program_2 = updateProgram(program_1, ["a.ts"], options, files => {
                files[0].text = files[0].text.updateProgram("var x = 2");
            });
            assert.isTrue(program_1.structureIsReused);

            // content of resolution cache should not change
            checkResolvedTypeDirectivesCache(program_1, "a.ts", { "typedefs": { resolvedFileName: "types/typedefs/index.d.ts", primary: true } });
            checkResolvedTypeDirectivesCache(program_1, "types/typedefs/index.d.ts", undefined);

            // type reference directives has changed - program is not reused
            var program_3 = updateProgram(program_2, ["a.ts"], options, files => {
                files[0].text = files[0].text.updateReferences("");
            });

            assert.isTrue(!program_2.structureIsReused);
            checkResolvedTypeDirectivesCache(program_3, "a.ts", undefined);

            var program_4 = updateProgram(program_3, ["a.ts"], options, files => {
                let newReferences = `/// <reference types="typedefs"/>
                /// <reference types="typedefs2"/>
                `;
                files[0].text = files[0].text.updateReferences(newReferences);
            });
            assert.isTrue(!program_3.structureIsReused);
            checkResolvedTypeDirectivesCache(program_1, "a.ts", { "typedefs": { resolvedFileName: "types/typedefs/index.d.ts", primary: true } });
        });
    })
}
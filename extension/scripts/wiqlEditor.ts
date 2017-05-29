import { getCompletionProvider } from "./wiqlCompletion";
import { parse } from "./compiler/wiqlParser";
import { format } from "./wiqlFormatter";
import { ErrorChecker } from "./wiqlErrorCheckers/ErrorChecker";
import * as Wiql from "./wiqlDefinition";
import { setVersion } from "./queryResults";
import { getHoverProvider } from "./wiqlHoverProvider";
import { importWiq, exportWiq } from "./wiqImportExport";
import { DelayedFunction } from "VSS/Utils/Core";

export function setupEditor(target: HTMLElement, onChange?: (errorCount: number) => void, intialValue?: string, queryName?: string): monaco.editor.IStandaloneCodeEditor {
    setVersion();
    monaco.languages.register(Wiql.def);
    monaco.languages.onLanguage(Wiql.def.id, () => {
        monaco.languages.setMonarchTokensProvider(Wiql.def.id, Wiql.language);
        monaco.languages.setLanguageConfiguration(Wiql.def.id, Wiql.conf);
    });
    const defaultVal =
        `SELECT
        [System.Id],
        [System.WorkItemType],
        [System.Title],
        [System.State],
        [System.AreaPath],
        [System.IterationPath]
FROM workitems
WHERE
        [System.TeamProject] = @project
ORDER BY [System.ChangedDate] DESC
`;
    const editor = monaco.editor.create(target, {
        language: Wiql.def.id,
        value: intialValue || defaultVal,
        automaticLayout: true
    });

    format(editor);
    editor.addAction({
        id: "format",
        contextMenuGroupId: "1_modification",
        label: "Format",
        keybindings: [
            monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KEY_F,
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KEY_F
        ],
        run: e => { format(editor); return null as any; }
    });
    $(".wiq-input").change(() => importWiq(editor));
    $(".wiq-export").click(() => exportWiq(editor, queryName));
    monaco.languages.registerHoverProvider(Wiql.def.id, getHoverProvider());
    monaco.languages.registerCompletionItemProvider(Wiql.def.id, getCompletionProvider());

    const model = editor.getModel();
    const errorChecker = new ErrorChecker();
    let oldDecorations: string[] = [];

    function checkErrors(): Q.IPromise<number> {
        const lines = model.getLinesContent();
        const parseResult = parse(lines);
        return errorChecker.check(parseResult).then(errors => {
            oldDecorations = model.deltaDecorations(oldDecorations, errors);
            return errors.length;
        });
    }
    checkErrors();

    const updateErrors = new DelayedFunction(null, 200, "CheckErrors", () => {
        checkErrors().then(errorCount => {
            if (onChange) {
                onChange(errorCount);
            }
        });
    });
    editor.onDidChangeModelContent(() => {
        updateErrors.reset();
    });

    editor.focus();
    return editor;
}

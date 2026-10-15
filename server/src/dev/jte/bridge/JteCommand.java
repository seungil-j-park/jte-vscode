package dev.jte.bridge;

import java.net.URI;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.google.gson.Gson;
import org.eclipse.core.resources.ResourcesPlugin;
import org.eclipse.core.runtime.IProgressMonitor;
import org.eclipse.jdt.core.ICompilationUnit;
import org.eclipse.jdt.core.IJavaElement;
import org.eclipse.jdt.core.IJavaProject;
import org.eclipse.jdt.core.IPackageFragmentRoot;
import org.eclipse.jdt.core.JavaCore;
import org.eclipse.jdt.core.dom.AST;
import org.eclipse.jdt.core.dom.ASTParser;
import org.eclipse.jdt.core.dom.CompilationUnit;
import org.eclipse.jdt.ls.core.internal.IDelegateCommandHandler;
import org.eclipse.jdt.ls.core.internal.JDTUtils;
import org.eclipse.jdt.ls.core.internal.JavaLanguageServerPlugin;
import org.eclipse.jdt.ls.core.internal.handlers.CompletionHandler;
import org.eclipse.jdt.ls.core.internal.handlers.CompletionResolveHandler;
import org.eclipse.jdt.ls.core.internal.handlers.HoverHandler;
import org.eclipse.jdt.ls.core.internal.handlers.NavigateToDefinitionHandler;
import org.eclipse.jdt.ls.core.internal.handlers.SignatureHelpHandler;
import org.eclipse.lsp4j.CompletionItem;
import org.eclipse.lsp4j.CompletionParams;
import org.eclipse.lsp4j.Location;
import org.eclipse.lsp4j.Position;
import org.eclipse.lsp4j.SignatureHelpParams;
import org.eclipse.lsp4j.TextDocumentIdentifier;
import org.eclipse.lsp4j.TextDocumentPositionParams;

/** Handle JTE Java analysis through in-memory working copies in the original project. */
public final class JteCommand implements IDelegateCommandHandler {
    private final Gson gson = new Gson();
    private final Map<String, ICompilationUnit> copies = new HashMap<>();

    /** Serialize server commands so code versions and analysis results cannot be mixed. */
    @Override
    public synchronized Object executeCommand(String commandId, List<Object> arguments, IProgressMonitor monitor)
            throws Exception {
        Request request = gson.fromJson((String) arguments.get(0), Request.class);
        if ("close".equals(request.operation)) {
            ICompilationUnit old = copies.remove(request.sourceUri);
            if (old != null) old.discardWorkingCopy();
            return "{}";
        }
        if ("status".equals(request.operation)) {
            return gson.toJson(Map.of("workingCopies", copies.size(), "projects", projects()));
        }
        ICompilationUnit unit = copies.get(request.sourceUri);
        if (unit == null || !unit.getJavaProject().exists()) {
            if (unit != null) unit.discardWorkingCopy();
            IPackageFragmentRoot root = sourceRoot(request.sourceUri);
            // Use a unique name in the default package without creating a disk resource.
            unit = root.getPackageFragment("").getCompilationUnit(request.className + ".java");
            unit.becomeWorkingCopy(monitor);
            copies.put(request.sourceUri, unit);
        }
        unit.getBuffer().setContents(request.code);
        unit.reconcile(AST.getJLSLatest(),
                ICompilationUnit.FORCE_PROBLEM_DETECTION | ICompilationUnit.ENABLE_BINDINGS_RECOVERY
                        | ICompilationUnit.ENABLE_STATEMENTS_RECOVERY, null, monitor);
        String uri = JDTUtils.toURI(unit).toString();
        var prefs = JavaLanguageServerPlugin.getPreferencesManager();
        TextDocumentIdentifier document = new TextDocumentIdentifier(uri);
        Position position = position(request.code, request.offset);
        Object result;
        switch (request.operation) {
            case "definition": {
                List<Location> locations = new ArrayList<>();
                for (IJavaElement element : unit.codeSelect(request.offset, 0)) {
                    // Resolve positions in our working copy directly because normal server navigation excludes files absent from disk.
                    Location location = unit.equals(element.getAncestor(IJavaElement.COMPILATION_UNIT))
                            ? JDTUtils.toLocation(element)
                            : NavigateToDefinitionHandler.computeDefinitionNavigation(element, unit.getJavaProject());
                    if (location != null) locations.add(location);
                }
                result = locations;
                break;
            }
            case "completion": {
                var completion = new CompletionHandler(prefs).completion(new CompletionParams(document, position), monitor);
                List<CompletionItem> items = completion.isLeft() ? completion.getLeft() : completion.getRight().getItems();
                // Resolve completion items so the server supplies final replacement ranges and import edits.
                var resolver = new CompletionResolveHandler(prefs);
                int count = 0;
                for (CompletionItem item : items) {
                    if (count++ >= 100 || monitor.isCanceled()) break;
                    resolver.resolve(item, monitor);
                }
                result = items;
                break;
            }
            case "hover":
                result = new HoverHandler(prefs).hover(new TextDocumentPositionParams(document, position), monitor);
                break;
            case "signature":
                result = new SignatureHelpHandler(prefs).signatureHelp(new SignatureHelpParams(document, position), monitor);
                break;
            case "diagnostics": {
                List<Map<String, Object>> problems = new ArrayList<>();
                // Explicitly obtain a diagnostic AST for each request because reconciliation can omit it for unchanged copies.
                ASTParser parser = ASTParser.newParser(AST.getJLSLatest());
                parser.setSource(unit);
                parser.setResolveBindings(true);
                parser.setBindingsRecovery(true);
                parser.setStatementsRecovery(true);
                CompilationUnit ast = (CompilationUnit) parser.createAST(monitor);
                if (ast != null) {
                    for (var problem : ast.getProblems()) {
                        if (!problem.isError()) continue;
                        problems.add(Map.of("start", problem.getSourceStart(), "end", problem.getSourceEnd() + 1,
                                "message", problem.getMessage(), "code", problem.getID()));
                    }
                }
                result = problems;
                break;
            }
            default:
                result = Map.of("resolved", JDTUtils.resolveCompilationUnit(uri) != null);
        }
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("uri", uri);
        response.put("project", unit.getJavaProject().getElementName());
        response.put("result", result);
        return gson.toJson(response);
    }

    /** Return imported project names to inspect project loading status. */
    private List<String> projects() throws Exception {
        List<String> result = new ArrayList<>();
        for (IJavaProject project : JavaCore.create(ResourcesPlugin.getWorkspace().getRoot()).getJavaProjects()) {
            result.add(project.getElementName());
        }
        return result;
    }

    /** Select the nearest owning Java module and its main or test source root. */
    private IPackageFragmentRoot sourceRoot(String sourceUri) throws Exception {
        Path source = Path.of(URI.create(sourceUri)).normalize();
        IJavaProject best = null;
        int depth = -1;
        for (IJavaProject project : JavaCore.create(ResourcesPlugin.getWorkspace().getRoot()).getJavaProjects()) {
            URI location = project.getProject().getLocationURI();
            if (location == null || !"file".equals(location.getScheme())) continue;
            Path directory = Path.of(location).normalize();
            if (source.startsWith(directory) && directory.getNameCount() > depth) {
                best = project;
                depth = directory.getNameCount();
            }
        }
        if (best == null) throw new IllegalStateException("The Java project owning this JTE file has not loaded yet.");
        boolean test = source.toString().replace('\\', '/').contains("/src/test/");
        List<IPackageFragmentRoot> candidates = new ArrayList<>();
        for (IPackageFragmentRoot root : best.getPackageFragmentRoots()) {
            if (root.getKind() != IPackageFragmentRoot.K_SOURCE || !root.getJavaProject().equals(best)) continue;
            boolean testRoot = root.getRawClasspathEntry().isTest();
            String portable = root.getPath().toPortableString();
            if (portable.endsWith(test ? "/src/test/java" : "/src/main/java")) return root;
            if (testRoot == test) candidates.add(root);
        }
        if (candidates.size() == 1) return candidates.get(0);
        throw new IllegalStateException("Cannot determine a unique Java source root for JTE analysis: " + best.getElementName());
    }

    /** Convert UTF-16 offsets into language server line and character positions. */
    private Position position(String text, int offset) {
        int line = 0;
        int start = 0;
        for (int i = 0; i < Math.min(offset, text.length()); i++) {
            if (text.charAt(i) == '\n') { line++; start = i + 1; }
        }
        return new Position(line, offset - start);
    }

    /** Hold analysis input for the document version sent by the client. */
    private static final class Request {
        String operation;
        String sourceUri;
        String className;
        String code;
        int offset;
    }
}

import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type OnNodesChange,
  type Node,
  type ReactFlowInstance,
  type FitViewOptions,
  type IsValidConnection,
  type OnConnectEnd,
} from "@xyflow/react";
import {
  LAYOUT,
  NODE_KIND_INFO,
  applySuggestion,
  describeSuggestion,
  specOf,
  type Suggestion,
  diffFlows,
  layoutFlow,
  serializeFlow,
  type DraftFlow,
  type FlowFile,
  type ImportedFlow,
  type PluginsInfo,
  type NodeKind,
} from "@flowcommit/shared";
import { api, secretsIn, type Graph, type HistoryState, type PullRequest, type Version } from "./api.ts";
import { SecretsDialog, type SecretsCheck } from "./components/SecretsDialog.tsx";
import {
  DEFAULT_EDGE_OPTIONS,
  fromCanvas,
  newId,
  toCanvas,
  toCanvasEdge,
  type ArrowEdge,
  type FlowMeta,
  type StepData,
  type StepNode,
} from "./model.ts";
import { StepActions, StepCard, StepReading } from "./components/StepCard.tsx";
import { ArrowFocus, FlowArrow, type ArrowData } from "./components/FlowArrow.tsx";
import { Outline } from "./components/Outline.tsx";
import { Walkthrough } from "./components/Walkthrough.tsx";
import { arrowTone, decisionSide, isBackEdge, readingNumbers, related } from "./flowView.ts";
import { KIND_DRAG_TYPE, Palette } from "./components/Palette.tsx";
import { Inspector, type Selection } from "./components/Inspector.tsx";
import type { Review } from "./components/CompareView.tsx";
// History loads the first time it's opened, so the editor starts faster.
const CompareView = lazy(() => import("./components/CompareView.tsx").then((m) => ({ default: m.CompareView })));
import { BranchMenu } from "./components/BranchMenu.tsx";
import { commitLabel, shortSha, type Side } from "./compare.ts";
import { SaveVersionDialog } from "./components/SaveVersionDialog.tsx";
import { Welcome } from "./components/Welcome.tsx";
import { ProjectMenu } from "./components/ProjectMenu.tsx";
import { FirstRunTips, tipsSeen } from "./components/FirstRunTips.tsx";
import { GroupActionsContext, GroupCard, GroupFrames, type GroupActions } from "./components/Groups.tsx";
import { foldGroups, isGroupCard, newGroupId, type CanvasNode } from "./groups.ts";
import { printPicture } from "./printPicture.ts";
// The picture library loads only when someone exports.
const loadExport = () => import("./exportImage.ts");
import { AiPicker } from "./components/AiPicker.tsx";
import { useToast } from "./components/Toasts.tsx";
import { useAi } from "./ai.tsx";
import { Icon, Logo } from "./icons.tsx";
import type { Template } from "./templates.ts";
import { BuildContext, useBuild } from "./build.tsx";
import { SyncContext, useSync } from "./sync.tsx";
import { SyncPanel } from "./components/SyncPanel.tsx";
import { BuildDialog } from "./components/BuildDialog.tsx";
import { arrange } from "./arrange.ts";
import { useUndo } from "./undo.ts";
import { copyPayload, instantiate, parsePayload } from "./clipboard.ts";
import { SearchBox } from "./components/SearchBox.tsx";
import { Legend, ViewMenu, useViewOptions } from "./components/ViewMenu.tsx";

const nodeTypes = { step: StepCard, folded: GroupCard };
const edgeTypes = { flow: FlowArrow };
const ARROW_COLOR = { yes: "var(--add)", no: "var(--del)", back: "var(--arrow-back)", plain: "var(--arrow)" } as const;
const SAVE_DELAY_MS = 600;
const NEW_STEP_OFFSET = { x: LAYOUT.cardWidth / 2, y: 40 };
/** Leaves room for the floating toolbar and side panel so no card hides behind them. */
const FOLDED_KEY = "flowcommit.folded-groups";
function readFolded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

const FIT_VIEW = {
  padding: { top: "48px", bottom: "120px", left: "48px", right: "420px" },
  maxZoom: 1,
} as const;


const EMPTY_GRAPH: Graph = {
  commits: [],
  branches: [],
  current: { branch: null, tip: null },
  defaultBranch: "main",
  sync: { upstream: null, ahead: 0, behind: 0 },
  remote: null,
};

type LoadState = { status: "loading" } | { status: "ready" } | { status: "failed"; message: string };
type SaveState = { status: "saved" } | { status: "saving" } | { status: "failed"; message: string };
type Mode = "edit" | "history";

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function App() {
  const rf = useReactFlow<StepNode, ArrowEdge>();
  const notify = useToast();
  const { active: ai } = useAi();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ArrowEdge>([]);
  const [meta, setMeta] = useState<FlowMeta>({ name: "", description: "", groups: [] });
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [save, setSave] = useState<SaveState>({ status: "saved" });
  const [mode, setMode] = useState<Mode>("edit");
  const [history, setHistory] = useState<{ state: HistoryState; versions: Version[] }>({
    state: "ready",
    versions: [],
  });
  const [headFlow, setHeadFlow] = useState<FlowFile | null>(null);
  const [saveDialog, setSaveDialog] = useState(false);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [buildDialog, setBuildDialog] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [tipsDone, setTipsDone] = useState(tipsSeen);
  // What plugins added: share options and builders. Templates are fetched by the welcome screen.
  const [plugins, setPlugins] = useState<PluginsInfo | null>(null);
  useEffect(() => {
    api.plugins().then(setPlugins).catch(() => {});
  }, []);
  const [focusTitleKey, setFocusTitleKey] = useState(0);
  const view = useViewOptions();

  // React Flow measures each card once, when it first appears, and only measures again if its
  // size changes. If cards are replaced while that first measurement is under way, the sizes
  // are lost for good, and everything that needs them (fitting the view, tidying up) silently
  // stops working. So whenever a card is missing its size, ask React Flow to measure it again.
  const updateNodeInternals = useUpdateNodeInternals();
  const unmeasured = nodes.filter((n) => !n.measured?.width).map((n) => n.id).join(",");
  useEffect(() => {
    if (!unmeasured) return;
    const frame = requestAnimationFrame(() => updateNodeInternals(unmeasured.split(",")));
    return () => cancelAnimationFrame(frame);
  }, [unmeasured, updateNodeInternals]);
  // React Flow hands back a new helper object once the canvas mounts. Reading it through a ref
  // keeps loadFlow stable, so the flow loads once instead of again after mounting.
  const rfRef = useRef(rf);
  rfRef.current = rf;
  const fitRef = useRef<FitViewOptions>(FIT_VIEW);
  // Zooming to fit leaves room for the outline on the left and the shape legend on the right.
  fitRef.current = {
    ...FIT_VIEW,
    padding: {
      ...FIT_VIEW.padding,
      ...(view.options.outline ? { left: "330px" } : {}),
      ...(view.options.legend ? { right: "600px" } : {}),
    },
  };

  /**
   * Zooms to the whole flow once React Flow has taken in new positions (a frame or two later).
   * Browsers don't draw tabs in the background, so if the person switched away while AI was
   * working, this waits until they come back.
   */
  const fitSoon = useCallback(() => {
    const fit = () => setTimeout(() => void rfRef.current.fitView({ ...fitRef.current, duration: 400 }), 60);
    if (document.visibilityState === "visible") return void fit();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onVisible);
      fit();
    };
    document.addEventListener("visibilitychange", onVisible);
  }, []);

  // A drafted or template flow is laid out again once its cards are drawn, because only then
  // are their real sizes known. Then the view zooms to show all of it.
  const arrangeWhenReady = useRef(false);
  // Set once the undo history exists below.
  const amendUndo = useRef<() => void>(() => {});
  const allMeasured = nodes.length > 0 && nodes.every((n) => n.measured?.width);
  useEffect(() => {
    if (!allMeasured || !arrangeWhenReady.current) return;
    arrangeWhenReady.current = false;
    amendUndo.current(); // tidying up the new flow isn't a separate step to undo
    const next = arrange(nodes, edges);
    setNodes(next.nodes);
    setEdges(next.edges);
    fitSoon();
  }, [allMeasured, nodes, edges, fitSoon, setNodes, setEdges]);

  // Saves run one after another so an older save can never overwrite a newer one.
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const savedText = useRef("");
  const latest = useRef<{ flow: FlowFile; text: string } | null>(null);

  // Only the newest load may update the canvas (React runs effects twice in development).
  const loadRun = useRef(0);
  // Set once the undo history exists below; loading a different flow starts a fresh history.
  const resetUndo = useRef<() => void>(() => {});

  const loadFlow = useCallback(async (opts: { keepView?: boolean } = {}) => {
    const run = ++loadRun.current;
    setLoad({ status: "loading" });
    try {
      const flow = await api.loadFlow();
      if (run !== loadRun.current) return;
      const text = serializeFlow(flow);
      // Nothing new on disk: keep the canvas and its undo history as they are.
      if (opts.keepView && latest.current?.text === text) {
        savedText.current = text;
        setLoad({ status: "ready" });
        return;
      }
      const canvas = toCanvas(flow);
      savedText.current = text;
      setMeta(canvas.meta);
      // Keep the sizes React Flow already measured. A card whose size doesn't change is never
      // measured again, and without sizes React Flow quietly stops fitting the view.
      setNodes((prev) => {
        const measured = new Map(prev.map((n) => [n.id, n.measured]));
        return canvas.nodes.map((n) => ({ ...n, measured: measured.get(n.id) }));
      });
      setEdges(canvas.edges);
      setLoad({ status: "ready" });
      resetUndo.current();
      if (!opts.keepView) setTimeout(() => void rfRef.current.fitView(fitRef.current), 60);
    } catch (err) {
      if (run !== loadRun.current) return;
      setLoad({ status: "failed", message: (err as Error).message });
    }
  }, [setNodes, setEdges]);

  const loadHistory = useCallback(async () => {
    try {
      const next = await api.history();
      setHistory(next);
      setHeadFlow(next.versions[0] ? await api.versionFlow(next.versions[0].sha) : null);
    } catch {
      // The editor still works without history; the timeline shows the error state when opened.
    }
  }, []);

  const loadGraph = useCallback(async () => {
    try {
      setGraph(await api.graph());
    } catch {
      // Branches are extra; the editor works without them.
    }
  }, []);

  useEffect(() => {
    void loadFlow();
    void loadHistory();
    void loadGraph();
  }, [loadFlow, loadHistory, loadGraph]);

  // Saving can change what Sync shows (a deleted step whose code is left over, say). Set below.
  const afterSave = useRef(() => {});

  // Autosave: every change to the design is written to .flowcommit/flow.json shortly after it happens.
  useEffect(() => {
    if (load.status !== "ready") return;
    const flow = fromCanvas(meta, nodes, edges);
    const text = serializeFlow(flow);
    latest.current = { flow, text };
    if (text === savedText.current) return;

    setSave({ status: "saving" });
    const timer = setTimeout(() => {
      saveChain.current = saveChain.current
        .then(() => api.saveFlow(flow))
        .then(() => {
          savedText.current = text;
          if (latest.current?.text === text) setSave({ status: "saved" });
          afterSave.current();
        })
        .catch((err: Error) => setSave({ status: "failed", message: err.message }));
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [load.status, meta, nodes, edges]);

  useEffect(() => {
    const flush = () => {
      if (latest.current && latest.current.text !== savedText.current) {
        void api.saveFlow(latest.current.flow, { keepalive: true }).catch(() => {});
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  /** Writes any pending autosave right away, for actions that need the file on disk to be current. */
  const flushSave = useCallback(async () => {
    saveChain.current = saveChain.current.then(async () => {
      const pending = latest.current;
      if (!pending || pending.text === savedText.current) return;
      await api.saveFlow(pending.flow);
      savedText.current = pending.text;
      if (latest.current?.text === pending.text) setSave({ status: "saved" });
    });
    await saveChain.current;
  }, []);

  // Changes since the last saved version. Deferred so that dragging a card stays smooth.
  const deferredNodes = useDeferredValue(nodes);
  const draft = useMemo(() => fromCanvas(meta, deferredNodes, edges), [meta, deferredNodes, edges]);
  const draftDiff = useMemo(() => {
    if (load.status !== "ready") return null;
    if (headFlow && serializeFlow(headFlow) === serializeFlow(draft)) return null;
    return diffFlows(headFlow, draft);
  }, [load.status, headFlow, draft]);

  // What the AI agent has built so far, kept live while it works.
  // Someone (or something) changed flow.json on disk. Pick up the change unless it would
  // throw away edits that haven't been saved yet; then let the person decide.
  // Set while FlowCommit itself changes the files (switching branches, pulling), so the file
  // watcher's echo of that change doesn't show a second, confusing notice.
  const ownGitChangeUntil = useRef(0);
  const sync = useSync();
  afterSave.current = () => void sync.refresh();
  const [syncOpen, setSyncOpen] = useState(false);
  const build = useBuild(draft, () => {
    const unsaved = latest.current && latest.current.text !== savedText.current;
    if (!unsaved) {
      void loadFlow({ keepView: true });
      if (Date.now() > ownGitChangeUntil.current) notify("Loaded changes made to the flow outside FlowCommit.");
      return;
    }
    notify("The flow was changed outside FlowCommit while you were editing.", {
      sticky: true,
      action: { label: "Load their changes", run: () => void loadFlow({ keepView: true }) },
    });
  }, () => {
    // A commit, pull, push or branch switch happened, here or in a terminal.
    void loadHistory();
    void loadGraph();
    void sync.refresh();
  }, () => void sync.refresh());

  /** Applies an AI suggestion to the draft. It then shows up like any other edit, and in the next version's diff. */
  const acceptSuggestion = async (s: Suggestion) => {
    const current = fromCanvas(meta, nodes, edges);
    const result = applySuggestion(current, s, newId);
    if ("error" in result) {
      notify(`${result.error} The suggestion was removed.`, { tone: "error" });
      await api.dismissSuggestion(s.id).catch(() => {});
      void sync.refresh();
      return;
    }
    const before = new Set(current.nodes.map((n) => n.id));
    const canvas = toCanvas(result.flow);
    setNodes((prev) => {
      const measured = new Map(prev.map((n) => [n.id, n.measured]));
      return canvas.nodes.map((n) => ({ ...n, measured: measured.get(n.id) }));
    });
    setEdges(canvas.edges);
    const added = canvas.nodes.find((n) => !before.has(n.id));
    // The code already does what the suggestion describes, so the step counts as built.
    const c = s.change;
    const stepId = c.type === "edit-step" || c.type === "remove-step" ? c.stepId : c.type === "add-step" ? added?.id : undefined;
    const changed = stepId ? result.flow.nodes.find((n) => n.id === stepId) : undefined;
    if (stepId && c.type === "remove-step") {
      await api.suggestionAccepted({ stepId, removed: true }).catch(() => {});
    } else if (stepId && changed) {
      await api.suggestionAccepted({ stepId, spec: specOf(changed), files: s.files, source: s.source }).catch(() => {});
    }
    await api.dismissSuggestion(s.id).catch(() => {});
    void sync.refresh();
    void build.refresh();
    notify(`Accepted: ${describeSuggestion(s, current)}. Save a version when you're happy with it.`);
    if (added) requestAnimationFrame(() => selectStep(added.id));
  };

  const dismissSuggestion = async (s: Suggestion) => {
    await api.dismissSuggestion(s.id).catch(() => {});
    void sync.refresh();
    notify("Suggestion dismissed");
  };
  const builtCount = build.plan.filter((p) => p.view === "built").length;
  const activeBuild = build.plan.some((p) => p.view === "building");

  const selectStep = (id: string) => {
    setMode("edit");
    // A step inside a folded group opens the group, so you can see it.
    const group = nodes.find((n) => n.id === id)?.data.group;
    if (group && folded.has(group)) groupActions.unfold(group);
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
    setEdges((es) => es.map((e) => ({ ...e, selected: false })));
    requestAnimationFrame(() => void rf.fitView({ nodes: [{ id }], ...fitRef.current, maxZoom: 1, duration: 300 }));
  };

  // Set when a save or push stopped because it looked like it contained passwords or keys.
  const [secretsCheck, setSecretsCheck] = useState<SecretsCheck | null>(null);

  const saveVersion = async (
    message: string,
    withCode: boolean,
    opts: { allowSecrets?: boolean; exclude?: string[] } = {},
  ): Promise<void> => {
    if (history.state === "not-repo") await api.turnOnHistory();
    await flushSave();
    let version: Version;
    try {
      version = await api.saveVersion(message, withCode, opts);
    } catch (err) {
      const found = secretsIn(err);
      if (!found) throw err;
      setSaveDialog(false);
      setSecretsCheck({
        context: "save",
        report: found,
        leaveOut: (files) => saveVersion(message, withCode, { ...opts, exclude: [...(opts.exclude ?? []), ...files] }),
        anyway: () => saveVersion(message, withCode, { ...opts, allowSecrets: true }),
        recheck: () => saveVersion(message, withCode, opts),
      });
      return;
    }
    setSecretsCheck(null);
    await loadHistory();
    await loadGraph();
    setSaveDialog(false);
    const left = opts.exclude?.length ?? 0;
    notify(
      `Version ${version.number} saved${withCode ? " with your code" : ""}${left ? `, leaving out ${left} ${left === 1 ? "file" : "files"}` : ""}`,
    );
  };

  const push = async (opts: { allowSecrets?: boolean } = {}): Promise<void> => {
    await flushSave();
    ownGitChangeUntil.current = Date.now() + 5000;
    try {
      await api.push(opts);
    } catch (err) {
      const found = secretsIn(err);
      if (!found) throw err;
      setSecretsCheck({
        context: "push",
        report: found,
        anyway: () => push({ allowSecrets: true }),
        recheck: () => push(),
      });
      return;
    }
    setSecretsCheck(null);
    await afterGitChange();
    notify("Pushed to GitHub");
  };

  /** Opens a saved version as a new branch, so both the design and the code go back to it. */
  const branchFromVersion = async (sha: string, name: string) => {
    await flushSave();
    ownGitChangeUntil.current = Date.now() + 3000;
    await api.branchFromVersion(sha, name);
    await afterGitChange();
    setReview(null);
    setMode("edit");
    notify(`Opened this version on the new branch ${name.trim().replace(/\s+/g, "-")}. Its design and code are back.`);
  };

  const restoreVersion = async (sha: string) => {
    await flushSave();
    await api.restoreVersion(sha);
    await loadFlow();
    await loadHistory();
    await loadGraph();
    setMode("edit");
    notify("Version restored. Save a version to keep it.");
  };

  const turnOnHistory = async () => {
    await api.turnOnHistory().catch(() => {});
    await loadHistory();
    await loadGraph();
  };

  // ----- Branches and GitHub -----

  const sideFor = (sha: string | null): Side => {
    if (!sha) return { kind: "empty" };
    const c = graph?.commits.find((x) => x.sha === sha);
    return { kind: "version", sha, label: c ? commitLabel(c) : shortSha(sha) };
  };

  const afterGitChange = async () => {
    ownGitChangeUntil.current = Date.now() + 3000;
    await loadFlow();
    await Promise.all([loadHistory(), loadGraph()]);
  };

  const switchBranch = async (branch: string) => {
    await flushSave();
    ownGitChangeUntil.current = Date.now() + 3000;
    await api.switchBranch(branch);
    await afterGitChange();
    setReview(null);
    // Switching to a GitHub branch (origin/feature) makes a local branch named feature.
    const isRemote = graph?.branches.find((b) => b.name === branch)?.remote;
    notify(`Switched to ${isRemote ? branch.replace(/^[^/]+\//, "") : branch}`);
  };

  const createBranch = async (name: string) => {
    await flushSave();
    await api.createBranch(name);
    await loadGraph();
    notify(`Created branch ${name.replace(/\s+/g, "-")}. New versions are saved on it.`);
  };

  /** Like reviewing a pull request: every design change on a branch since it split off. */
  const reviewBranch = async (branch: string) => {
    if (!graph) return;
    const into = graph.defaultBranch;
    const { sha: start } = await api.mergeBase(into, branch);
    const tip = graph.branches.find((b) => b.name === branch)?.tip ?? null;
    const web = graph.remote?.webUrl;
    setReview({
      title: `${branch} compared with ${into}`,
      base: sideFor(start),
      target: sideFor(tip),
      url: web ? `${web}/compare/${encodeURIComponent(into)}...${encodeURIComponent(branch.replace(/^origin\//, ""))}` : undefined,
    });
    setMode("history");
  };

  const reviewPullRequest = async (pr: PullRequest) => {
    try {
      const { head, base } = await api.fetchPullRequest(pr.number, pr.baseRefName);
      await loadGraph();
      setReview({ title: `#${pr.number} ${pr.title}`, base: sideFor(base), target: sideFor(head), url: pr.url });
      setMode("history");
    } catch (err) {
      notify((err as Error).message, { tone: "error" });
    }
  };

  const selectOnly = useCallback(
    (node: StepNode) => {
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
      setEdges((es) => es.map((e) => ({ ...e, selected: false })));
      setFocusTitleKey((k) => k + 1);
    },
    [setNodes, setEdges],
  );

  const addStep = useCallback(
    (kind: NodeKind, at?: { x: number; y: number }) => {
      let position: { x: number; y: number };
      if (at) {
        position = { x: at.x - NEW_STEP_OFFSET.x, y: at.y - NEW_STEP_OFFSET.y };
      } else {
        const box = canvasRef.current!.getBoundingClientRect();
        const center = rf.screenToFlowPosition({ x: box.left + box.width / 2 - 180, y: box.top + box.height / 2 });
        position = findFreeSpot(rf.getNodes(), { x: center.x - NEW_STEP_OFFSET.x, y: center.y - NEW_STEP_OFFSET.y }, "down");
      }
      selectOnly({
        id: newId("n"),
        type: "step",
        position,
        data: { kind, title: `New ${NODE_KIND_INFO[kind].label.toLowerCase()}`, instructions: "", attachments: [], tags: [] },
      });
    },
    [rf, selectOnly],
  );

  /** Adds a step right below another one and connects them, ready to type its title. */
  const addAfter = useCallback(
    (sourceId: string) => {
      const source = rf.getNode(sourceId);
      if (!source || source.data.kind === "end") return;
      const below = {
        x: source.position.x,
        y: source.position.y + (source.measured?.height ?? 100) + 80,
      };
      const node: StepNode = {
        id: newId("n"),
        type: "step",
        position: findFreeSpot(rf.getNodes(), below, "right"),
        data: { kind: "step", title: "", instructions: "", attachments: [], tags: [] },
      };
      selectOnly(node);
      setEdges((es) => [...es, toCanvasEdge(newId("e"), sourceId, node.id, "")]);
      requestAnimationFrame(() => {
        const viewportHasRoom = rf.getViewport().zoom > 0.4;
        if (viewportHasRoom) void rf.fitView({ nodes: [{ id: node.id }, { id: sourceId }], ...fitRef.current, duration: 250 });
      });
    },
    [rf, selectOnly, setEdges],
  );

  /** Replaces the canvas with a drafted or template flow, laid out top to bottom. */
  const applyFlow = useCallback(
    (flow: DraftFlow, description: string, message: string, onUndo?: () => void) => {
      const before = { meta, nodes, edges };
      const ids = new Map(flow.steps.map((s) => [s.id, newId("n")]));
      const arrows = flow.arrows.map((a) => ({ source: ids.get(a.from)!, target: ids.get(a.to)!, label: a.label }));
      const starts = flow.steps.filter((s) => s.kind === "start").map((s) => ids.get(s.id)!);
      const positions = layoutFlow([...ids.values()], arrows, starts);
      setNodes(
        flow.steps.map((s) => ({
          id: ids.get(s.id)!,
          type: "step",
          position: positions.get(ids.get(s.id)!)!,
          data: { kind: s.kind, title: s.title, instructions: s.instructions, attachments: [], tags: [] },
        })),
      );
      setEdges(arrows.map((a) => toCanvasEdge(newId("e"), a.source, a.target, a.label)));
      setMeta((m) => ({ name: flow.name || m.name, description: description || m.description, groups: [] }));
      setWelcomeDismissed(true);
      arrangeWhenReady.current = true;
      notify(message, {
        action: {
          label: "Undo",
          run: () => {
            setMeta(before.meta);
            setNodes(before.nodes);
            setEdges(before.edges);
            setWelcomeDismissed(false);
            onUndo?.();
          },
        },
      });
      return ids;
    },
    [meta, nodes, edges, setNodes, setEdges, notify],
  );

  /** Draws a flow the AI read from the project's code. Steps the code already does count as built. */
  const applyImported = async (flow: ImportedFlow) => {
    let stepIds = new Map<string, string>();
    const forget = () => void api.markImported({ remove: [...stepIds.values()] }).then(() => build.refresh());
    stepIds = applyFlow(
      flow,
      flow.description,
      `${ai?.label ?? "AI"} drew ${flow.steps.length} steps from your code. Check it over, then save a version.`,
      forget,
    );
    const done = flow.steps.filter((s) => s.done);
    try {
      await api.markImported({
        source: ai?.label ?? "",
        steps: done.map((s) => ({
          stepId: stepIds.get(s.id)!,
          spec: specOf({ kind: s.kind, title: s.title, instructions: s.instructions, attachments: [], tags: [] }),
          files: s.files,
        })),
      });
      await build.refresh();
    } catch (err) {
      notify(`The flow is drawn, but FlowCommit couldn't mark its steps as built: ${(err as Error).message}`);
    }
  };

  /** Re-arranges every step top to bottom, keeping all text and arrows as they are. */
  const tidyUp = useCallback(() => {
    const before = { nodes, edges };
    const next = arrange(nodes, edges);
    setNodes(next.nodes);
    setEdges(next.edges);
    fitSoon();
    notify("Steps tidied up", {
      action: {
        label: "Undo",
        run: () => {
          setNodes(before.nodes);
          setEdges(before.edges);
        },
      },
    });
  }, [nodes, edges, fitSoon, setNodes, setEdges, notify]);

  const onDrop = useCallback(
    (e: DragEvent) => {
      const kind = e.dataTransfer.getData(KIND_DRAG_TYPE) as NodeKind;
      if (!kind) return;
      e.preventDefault();
      addStep(kind, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [addStep, rf],
  );

  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((es) => addEdge(toCanvasEdge(newId("e"), c.source, c.target, "", c.sourceHandle), es)),
    [setEdges],
  );

  const isValidConnection: IsValidConnection = useCallback((c) => c.source !== c.target, []);

  // Letting go anywhere on a step connects to it, not only when the arrow lands exactly on its dot.
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (state.isValid || !state.fromNode || !state.fromHandle) return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      const el = document.elementFromPoint(point.clientX, point.clientY)?.closest(".react-flow__node");
      const otherId = el?.getAttribute("data-id");
      if (!otherId || otherId === state.fromNode.id) return;
      const fromSource = state.fromHandle.type === "source";
      const source = fromSource ? state.fromNode.id : otherId;
      const target = fromSource ? otherId : state.fromNode.id;
      if (rf.getNode(source)?.data.kind === "end" || rf.getNode(target)?.data.kind === "start") return;
      onConnect({ source, target, sourceHandle: fromSource ? (state.fromHandle.id ?? null) : null, targetHandle: null });
    },
    [rf, onConnect],
  );

  const updateNode = useCallback(
    (id: string, patch: Partial<StepData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [setNodes],
  );

  // ----- Groups: named parts of the flow that can be folded into one card -----

  // Folding is how you look at the flow, not part of the design, so it's kept in this browser only.
  const [folded, setFolded] = useState<Set<string>>(() => readFolded());
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify([...folded]));
    } catch {
      // Private windows can refuse storage; folding still works until the page reloads.
    }
  }, [folded]);

  const groupSelection = useCallback(() => {
    const ids = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    if (!ids.size) return;
    const id = newGroupId();
    setMeta((m) => ({ ...m, groups: [...m.groups, { id, title: "New group" }] }));
    setNodes((ns) => ns.map((n) => (ids.has(n.id) ? { ...n, data: { ...n.data, group: id } } : n)));
    setEditingGroup(id);
  }, [nodes, setNodes]);

  const groupActions = useMemo<GroupActions>(
    () => ({
      fold: (id) => {
        // Hidden steps mustn't stay selected, or Delete would remove steps you can't see.
        setNodes((ns) => ns.map((n) => (n.data.group === id && n.selected ? { ...n, selected: false } : n)));
        setFolded((f) => new Set([...f, id]));
      },
      unfold: (id) => setFolded((f) => new Set([...f].filter((g) => g !== id))),
      rename: (id, title) => setMeta((m) => ({ ...m, groups: m.groups.map((g) => (g.id === id ? { ...g, title } : g)) })),
      ungroup: (id) => {
        setNodes((ns) =>
          ns.map((n) => {
            if (n.data.group !== id) return n;
            const { group: _group, ...data } = n.data;
            return { ...n, data };
          }),
        );
        setMeta((m) => ({ ...m, groups: m.groups.filter((g) => g.id !== id) }));
        setFolded((f) => new Set([...f].filter((g) => g !== id)));
      },
      move: (id, dx, dy) =>
        setNodes((ns) =>
          ns.map((n) => (n.data.group === id ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)),
        ),
      moved: () => {},
    }),
    [setNodes],
  );

  const updateEdgeLabel = useCallback(
    (id: string, label: string) =>
      setEdges((es) => es.map((e) => (e.id === id ? { ...e, label: label || undefined, data: { label } } : e))),
    [setEdges],
  );

  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedEdges = edges.filter((e) => e.selected);
  const selectedCount = selectedNodes.length + selectedEdges.length;
  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.data.title || "Untitled step";
  const selection: Selection =
    selectedCount === 0
      ? { type: "none" }
      : selectedCount > 1
        ? { type: "many", count: selectedCount, steps: selectedNodes.length }
        : selectedNodes.length === 1
          ? {
              type: "node",
              node: selectedNodes[0],
              previous: edges.filter((e) => e.target === selectedNodes[0].id).map((e) => titleOf(e.source)),
              next: edges.filter((e) => e.source === selectedNodes[0].id).map((e) => titleOf(e.target)),
              build: build.views.get(selectedNodes[0].id),
            }
          : {
              type: "edge",
              edge: selectedEdges[0],
              from: titleOf(selectedEdges[0].source),
              to: titleOf(selectedEdges[0].target),
            };

  const undo = useUndo({ meta, nodes, edges }, load.status === "ready", (snapshot) => {
    setMeta(snapshot.meta);
    setNodes((prev) => {
      const measured = new Map(prev.map((n) => [n.id, n.measured]));
      return snapshot.nodes.map((n) => ({ ...n, measured: measured.get(n.id) }));
    });
    setEdges(snapshot.edges);
  });
  resetUndo.current = undo.reset;
  amendUndo.current = undo.amend;

  // ----- Copy, cut, paste, duplicate and search -----

  const pasteCount = useRef(0);
  const insertCopies = useCallback(
    (payload: NonNullable<ReturnType<typeof parsePayload>>, verb = "Pasted") => {
      pasteCount.current += 1;
      const copies = instantiate(payload, 40 * pasteCount.current);
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...copies.nodes]);
      setEdges((es) => [...es.map((e) => ({ ...e, selected: false })), ...copies.edges]);
      notify(`${verb} ${copies.nodes.length} ${copies.nodes.length === 1 ? "step" : "steps"}`);
    },
    [setNodes, setEdges, notify],
  );

  useEffect(() => {
    if (mode !== "edit") return;
    const selected = () => nodes.filter((n) => n.selected);
    const onCopy = (e: ClipboardEvent) => {
      if (isTyping(e.target) || !selected().length) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", copyPayload(selected(), edges));
      pasteCount.current = 0;
      if (e.type === "cut") void rf.deleteElements({ nodes: selected().map((n) => ({ id: n.id })) });
      notify(`${e.type === "cut" ? "Cut" : "Copied"} ${selected().length} ${selected().length === 1 ? "step" : "steps"}`);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const payload = parsePayload(e.clipboardData?.getData("text/plain") ?? "");
      if (!payload) return;
      e.preventDefault();
      insertCopies(payload);
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, [mode, nodes, edges, rf, insertCopies, notify]);

  const duplicateSelection = () => {
    const sel = nodes.filter((n) => n.selected);
    if (!sel.length) return;
    pasteCount.current = 0;
    insertCopies(parsePayload(copyPayload(sel, edges))!, "Duplicated");
  };

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<Set<string> | null>(null);

  // Keyboard: ⌘S saves a version, Tab adds the next step after the selected one.
  const selectedId = selectedNodes.length === 1 ? selectedNodes[0].id : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      // In a text box, ⌘Z undoes typing as usual; on the canvas it undoes design changes.
      if ((e.metaKey || e.ctrlKey) && (key === "z" || key === "y") && mode === "edit" && !isTyping(e.target)) {
        e.preventDefault();
        if (key === "y" || e.shiftKey) undo.redo();
        else undo.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === "d" && mode === "edit" && !isTyping(e.target)) {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === "g" && mode === "edit" && !isTyping(e.target)) {
        e.preventDefault();
        groupSelection();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === "f" && mode === "edit") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === "s") {
        e.preventDefault();
        if (draftDiff) setSaveDialog(true);
        return;
      }
      if (e.key === "Tab" && mode === "edit" && selectedId && !isTyping(e.target)) {
        e.preventDefault();
        addAfter(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draftDiff, mode, selectedId, addAfter, undo, duplicateSelection, groupSelection]);

  // ----- Reading aids: numbers, highlighted paths, arrow styles and the walkthrough -----

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tour, setTour] = useState<{ current: string; history: string[] } | null>(null);
  const numbers = useMemo(() => readingNumbers(nodes), [nodes]);

  const focus = useMemo(() => {
    if (tour) {
      const out = edges.filter((e) => e.source === tour.current);
      return { nodes: new Set([tour.current, ...out.map((e) => e.target)]), edges: new Set(out.map((e) => e.id)) };
    }
    if (searchMatches) {
      return {
        nodes: searchMatches,
        edges: new Set(edges.filter((e) => searchMatches.has(e.source) && searchMatches.has(e.target)).map((e) => e.id)),
      };
    }
    const id = view.options.focus ? (hoveredId ?? selectedId) : null;
    return id ? related(id, nodes, edges) : null;
  }, [tour, searchMatches, hoveredId, selectedId, view.options.focus, nodes, edges]);

  const shownEdges = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return edges.map((e): ArrowEdge => {
      const label = e.data?.label ?? "";
      const back = isBackEdge(e, byId);
      const tone = back ? "back" : arrowTone(label);
      const lit = focus?.edges.has(e.id);
      const data: ArrowData = { label, tone: back ? "plain" : arrowTone(label), back, backTo: numbers.get(e.target) };
      const source = byId.get(e.source);
      const target = byId.get(e.target);
      // A decision's arrows always leave from the corner facing their target, even after cards move.
      const sourceHandle =
        source?.data.kind === "decision" && target ? (decisionSide(source, target, back) ?? null) : e.sourceHandle;
      return {
        ...e,
        sourceHandle,
        type: "flow",
        data,
        markerEnd: { ...DEFAULT_EDGE_OPTIONS.markerEnd, color: lit ? "var(--accent)" : ARROW_COLOR[tone] },
      };
    });
  }, [edges, nodes, numbers, focus]);

  // What the canvas draws: folded groups become single cards, and arrows go to those cards.
  // The cards aren't part of the design, so their measured sizes are kept here instead.
  const [cardSizes, setCardSizes] = useState<Map<string, { width: number; height: number }>>(new Map());
  const canvas = useMemo(() => {
    const view = foldGroups(nodes, shownEdges, meta.groups, folded, numbers);
    return {
      ...view,
      nodes: view.nodes.map((n) => (n.type === "folded" && cardSizes.has(n.id) ? { ...n, measured: cardSizes.get(n.id) } : n)),
    };
  }, [nodes, shownEdges, meta.groups, folded, numbers, cardSizes]);
  const onCanvasNodesChange = useCallback<OnNodesChange<CanvasNode>>(
    (changes) => {
      const sizes = changes.filter((c) => c.type === "dimensions" && isGroupCard(c.id) && c.dimensions);
      if (sizes.length) {
        setCardSizes((m) => {
          const next = new Map(m);
          for (const c of sizes) if (c.type === "dimensions" && c.dimensions) next.set(c.id, c.dimensions);
          return next;
        });
      }
      onNodesChange(changes.filter((c) => !("id" in c && isGroupCard(c.id))) as Parameters<typeof onNodesChange>[0]);
    },
    [onNodesChange],
  );

  const startTour = () => {
    const first =
      [...nodes].filter((n) => n.data.kind === "start").sort((a, b) => numbers.get(a.id)! - numbers.get(b.id)!)[0] ??
      [...nodes].sort((a, b) => numbers.get(a.id)! - numbers.get(b.id)!)[0];
    if (!first) return;
    setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
    setTour({ current: first.id, history: [] });
  };

  // Follow the walkthrough with the camera: frame the current step and where it can go next.
  useEffect(() => {
    if (!tour) return;
    const next = edges.filter((e) => e.source === tour.current).map((e) => ({ id: e.target }));
    void rf.fitView({
      nodes: [{ id: tour.current }, ...next],
      padding: { top: "80px", bottom: "300px", left: view.options.outline ? "340px" : "80px", right: "80px" },
      maxZoom: 1.1,
      duration: 500,
    });
  }, [tour, edges, rf, view.options.outline]);

  /** Sends the flow to a sharing option a plugin added, like a cloud share link. */
  const shareWith = async (id: string) => {
    await flushSave();
    try {
      const result = await api.share(id);
      notify(result.url ? `${result.message} ${result.url}` : result.message, {
        sticky: !!result.url,
        action: result.url
          ? { label: "Copy link", run: () => void navigator.clipboard.writeText(result.url!).catch(() => {}) }
          : undefined,
      });
    } catch (err) {
      notify((err as Error).message);
    }
  };

  /** Saves a picture of the flow as it looks now, for sharing in a doc or a chat. */
  const exportFlow = (format: "png" | "pdf") => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setHoveredId(null);
    // Give the canvas a frame to drop the selection highlight before drawing it.
    const exporter = loadExport();
    const picture = Promise.all([exporter, new Promise<void>((resolve) => setTimeout(resolve, 60))]).then(([m]) =>
      m.flowPicture(rf as unknown as ReactFlowInstance<Node>),
    );
    const title = meta.name || "Flowchart";
    if (format === "pdf") {
      try {
        printPicture(title, picture);
      } catch (err) {
        notify((err as Error).message);
      }
      return;
    }
    Promise.all([exporter, picture]).then(
      ([m, src]) => {
        m.download(src, m.fileName(title, "png"));
        notify("Picture saved to your downloads");
      },
      (err: Error) => notify(`FlowCommit couldn't make the picture: ${err.message}`),
    );
  };

  const isBlank =
    nodes.length <= 1 &&
    edges.length === 0 &&
    !nodes[0]?.data.instructions &&
    !nodes[0]?.data.attachments.length;
  const showWelcome = load.status === "ready" && mode === "edit" && isBlank && !welcomeDismissed;

  return (
    <div className="app" data-mode={mode} data-hide={view.hidden}>
      <header className="topbar">
        <span className="brand">
          <Logo />
          FlowCommit
        </span>
        <ProjectMenu flowName={meta.name} beforeSwitch={flushSave} />
        <div className="mode-switch" role="tablist" aria-label="View">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "edit"}
            onClick={() => {
              setMode("edit");
              setReview(null);
            }}
          >
            Design
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "history"}
            disabled={load.status !== "ready"}
            onClick={() => {
              void loadHistory();
              void loadGraph();
              setReview(null);
              setMode("history");
            }}
          >
            History
            {history.versions.length > 0 && <span className="count">{history.versions.length}</span>}
          </button>
        </div>
        <BranchMenu
          graph={graph}
          hasUnsavedDesign={!!draftDiff}
          onSwitch={switchBranch}
          onCreate={createBranch}
          onSync={async (what) => {
            if (what === "push") return push();
            ownGitChangeUntil.current = Date.now() + 5000;
            await (what === "pull" ? api.pull() : api.fetchRemote());
            await afterGitChange();
            notify(what === "pull" ? "Pulled the latest from GitHub" : "Checked GitHub for updates");
          }}
          onReviewBranch={(b) => void reviewBranch(b)}
          onReviewPullRequest={(pr) => void reviewPullRequest(pr)}
        />
        <ViewMenu
          options={view.options}
          onChange={view.setOptions}
          onExport={mode === "edit" && load.status === "ready" && !showWelcome ? exportFlow : undefined}
          shareTargets={plugins?.shareTargets}
          onShare={(id) => void shareWith(id)}
        />
        <button
          type="button"
          className="view-button"
          aria-pressed={!!tour}
          disabled={load.status !== "ready" || nodes.length === 0 || mode !== "edit"}
          onClick={() => (tour ? setTour(null) : startTour())}
          title="Go through the flow one step at a time"
          aria-label={tour ? "End walkthrough" : "Walk through"}
        >
          <Icon name="start" size={12} />
          <span className={tour ? undefined : "wide-only"}>{tour ? "End walkthrough" : "Walk through"}</span>
        </button>
        <div className="topbar-end">
          <AiPicker />
          <button
            type="button"
            className="sync-button"
            data-attention={sync.count > 0 || undefined}
            aria-pressed={syncOpen}
            disabled={load.status !== "ready"}
            title="Keep the design and the code in step"
            onClick={() => {
              void sync.refresh();
              setMode("edit");
              setSyncOpen((o) => !o);
            }}
          >
            <Icon name="sync" size={15} />
            Sync
            {sync.count > 0 && <span className="sync-count">{sync.count}</span>}
          </button>
          <button
            type="button"
            className="build-button"
            data-tip="build"
            data-active={activeBuild || undefined}
            disabled={load.status !== "ready"}
            onClick={() => {
              void build.refresh();
              setBuildDialog(true);
            }}
          >
            <Icon name="hammer" size={15} />
            Build
            {build.plan.length > 0 && (
              <span className="build-count">
                {builtCount}/{build.plan.length}
              </span>
            )}
          </button>
          <SaveIndicator state={save} />
          <button
            type="button"
            className="button-primary"
            data-tip="save"
            disabled={!draftDiff}
            title={draftDiff ? "Save a version of your design (⌘S)" : "No changes since the last version"}
            onClick={() => setSaveDialog(true)}
          >
            Save version
          </button>
        </div>
      </header>

      <div className="workspace">
        {mode === "history" ? (
          <Suspense fallback={<div className="canvas-message">Loading history…</div>}>
          <CompareView
            key={review ? `${review.title}:${review.target.kind === "version" ? review.target.sha : ""}` : "history"}
            state={history.state}
            graph={graph ?? EMPTY_GRAPH}
            draft={draft}
            draftStats={draftDiff?.stats ?? null}
            review={review}
            onReview={(branch) => void reviewBranch(branch)}
            onTurnOn={turnOnHistory}
            onRestore={restoreVersion}
            onBranch={branchFromVersion}
          />
          </Suspense>
        ) : (
          <SyncContext.Provider value={sync.byStep}>
          <BuildContext.Provider value={build.views}>
          <StepActions.Provider value={{ addAfter }}>
          <StepReading.Provider
            value={{
              numbers: view.options.numbers ? numbers : new Map(),
              focus: focus?.nodes ?? null,
              current: tour?.current ?? null,
            }}
          >
          <ArrowFocus.Provider value={{ active: !!focus, edges: focus?.edges ?? new Set() }}>
            <main className="canvas" ref={canvasRef} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
              {load.status === "failed" ? (
                <div className="canvas-message" role="alert">
                  <p>{load.message}</p>
                  <button type="button" className="button" onClick={() => void loadFlow()}>
                    Try again
                  </button>
                </div>
              ) : (
                <GroupActionsContext.Provider value={groupActions}>
                <ReactFlow<CanvasNode, ArrowEdge>
                  fitView
                  fitViewOptions={fitRef.current}
                  nodes={canvas.nodes}
                  edges={canvas.edges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodeMouseEnter={(_, n) => !isGroupCard(n.id) && setHoveredId(n.id)}
                  onNodeMouseLeave={() => setHoveredId(null)}
                  onNodesChange={onCanvasNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onConnectEnd={onConnectEnd}
                  onNodeDoubleClick={(_, n) => !isGroupCard(n.id) && setFocusTitleKey((k) => k + 1)}
                  isValidConnection={isValidConnection}
                  defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
                  deleteKeyCode={["Backspace", "Delete"]}
                  colorMode="system"
                  minZoom={0.2}
                >
                  <Background id="minor" variant={BackgroundVariant.Lines} gap={24} lineWidth={1} color="var(--grid-minor)" />
                  <Background
                    id="major"
                    variant={BackgroundVariant.Lines}
                    gap={120}
                    lineWidth={1}
                    color="var(--grid-major)"
                    bgColor="transparent"
                  />
                  <Controls showInteractive={false} position="bottom-left">
                    <ControlButton onClick={undo.undo} disabled={!undo.canUndo} title="Undo (⌘Z)" aria-label="Undo">
                      <Icon name="undo" size={14} />
                    </ControlButton>
                    <ControlButton onClick={undo.redo} disabled={!undo.canRedo} title="Redo (⌘⇧Z)" aria-label="Redo">
                      <Icon name="redo" size={14} />
                    </ControlButton>
                    <ControlButton onClick={tidyUp} title="Tidy up the layout" aria-label="Tidy up the layout">
                      <Icon name="tidy" size={14} />
                    </ControlButton>
                  </Controls>
                  <MiniMap
                    pannable
                    zoomable
                    position="bottom-left"
                    nodeClassName={(n) => (n.type === "folded" ? "minimap-node kind-group" : `minimap-node kind-${(n.data as StepData).kind}`)}
                  />
                  <GroupFrames
                    groups={meta.groups}
                    nodes={nodes}
                    folded={folded}
                    editing={editingGroup}
                    onEditDone={() => setEditingGroup(null)}
                  />
                </ReactFlow>
                </GroupActionsContext.Provider>
              )}
            </main>

            {view.options.legend && !showWelcome && <Legend />}
            {searchOpen && !showWelcome && (
              <SearchBox
                nodes={nodes}
                numbers={numbers}
                onMatches={setSearchMatches}
                onPick={(id) => selectStep(id)}
                onClose={() => setSearchOpen(false)}
              />
            )}
            {view.options.outline && !showWelcome && (
              <Outline
                nodes={nodes}
                edges={edges}
                numbers={numbers}
                onSelect={(id) => (tour ? setTour({ current: id, history: [...tour.history, tour.current] }) : selectStep(id))}
                onHover={setHoveredId}
                onWalkThrough={startTour}
              />
            )}

            {showWelcome ? (
              <Welcome
                initialDescription={meta.description}
                onImport={applyImported}
                onDraft={(flow, description) =>
                  applyFlow(
                    flow,
                    description,
                    `${ai?.label ?? "AI"} drew ${flow.steps.length} steps. Save a version when you like it.`,
                  )
                }
                onTemplate={(t: Template) =>
                  applyFlow(t.flow, t.description, `Started from the ${t.title} template, ${t.flow.steps.length} steps.`)
                }
                onBlank={() => setWelcomeDismissed(true)}
              />
            ) : tour && nodes.some((n) => n.id === tour.current) ? (
              <Walkthrough
                current={nodes.find((n) => n.id === tour.current)!}
                nodes={nodes}
                edges={edges}
                numbers={numbers}
                canGoBack={tour.history.length > 0}
                onGo={(id) => setTour({ current: id, history: [...tour.history, tour.current] })}
                onBack={() => setTour({ current: tour.history[tour.history.length - 1], history: tour.history.slice(0, -1) })}
                onRestart={startTour}
                onExit={() => {
                  const last = tour.current;
                  setTour(null);
                  selectStep(last);
                }}
              />
            ) : (
              <>
                <Palette disabled={load.status !== "ready"} onAdd={(kind) => addStep(kind)} />
                {syncOpen ? (
                  <SyncPanel
                    state={sync.state}
                    flow={draft}
                    onAccept={(s) => void acceptSuggestion(s)}
                    onDismiss={(s) => void dismissSuggestion(s)}
                    onShowStep={(id) => selectStep(id)}
                    onAnalyzed={(added) => {
                      void sync.refresh();
                      // -1 means a flag was cleared by hand; nothing new to announce.
                      if (added >= 0) {
                        notify(added ? `${added} ${added === 1 ? "suggestion" : "suggestions"} from the code` : "The flowchart already matches the code.");
                      }
                    }}
                    onClose={() => setSyncOpen(false)}
                  />
                ) : (
                <Inspector
                  selection={selection}
                  meta={meta}
                  stepCount={nodes.length}
                  allTags={[...new Set(nodes.flatMap((n) => n.data.tags))].sort()}
                  focusTitleKey={focusTitleKey}
                  onMetaChange={(patch) => setMeta((m) => ({ ...m, ...patch }))}
                  onNodeChange={updateNode}
                  onEdgeLabelChange={updateEdgeLabel}
                  onDeleteNode={(id) => void rf.deleteElements({ nodes: [{ id }] })}
                  onDeleteEdge={(id) => void rf.deleteElements({ edges: [{ id }] })}
                  onAddAfter={addAfter}
                  onResetBuild={(id) => void build.reset(id)}
                  onGroup={groupSelection}
                />
                )}
              </>
            )}
          </ArrowFocus.Provider>
          </StepReading.Provider>
          </StepActions.Provider>
          </BuildContext.Provider>
          </SyncContext.Provider>
        )}
      </div>

      {buildDialog && (
        <BuildDialog
          info={build.info}
          runners={plugins?.buildRunners}
          plan={build.plan}
          onConnected={() => void build.refresh()}
          onSelectStep={selectStep}
          onClose={() => setBuildDialog(false)}
        />
      )}

      {!tipsDone && load.status === "ready" && mode === "edit" && !showWelcome && !tour && nodes.length > 1 && (
        <FirstRunTips onDone={() => setTipsDone(true)} />
      )}
      {secretsCheck && (
        <SecretsDialog check={secretsCheck} onShowStep={selectStep} onClose={() => setSecretsCheck(null)} />
      )}
      {saveDialog && draftDiff && (
        <SaveVersionDialog
          state={history.state}
          flowName={meta.name}
          diff={draftDiff}
          nextNumber={(history.versions[0]?.number ?? 0) + 1}
          onSave={saveVersion}
          onClose={() => setSaveDialog(false)}
        />
      )}
    </div>
  );
}

/** Moves a new step down (or right) until it no longer covers an existing one. */
function findFreeSpot(nodes: StepNode[], start: { x: number; y: number }, direction: "down" | "right") {
  const GAP = 24;
  const size = { width: LAYOUT.cardWidth, height: 100 };
  const pos = { ...start };
  const overlaps = (n: StepNode) => {
    const w = n.measured?.width ?? size.width;
    const h = n.measured?.height ?? size.height;
    return (
      pos.x < n.position.x + w + GAP &&
      pos.x + size.width + GAP > n.position.x &&
      pos.y < n.position.y + h + GAP &&
      pos.y + size.height + GAP > n.position.y
    );
  };
  for (let tries = 0; tries < 50; tries++) {
    const hit = nodes.find(overlaps);
    if (!hit) break;
    if (direction === "down") pos.y = hit.position.y + (hit.measured?.height ?? size.height) + GAP * 2;
    else pos.x = hit.position.x + (hit.measured?.width ?? size.width) + GAP * 2;
  }
  return pos;
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state.status === "failed") {
    return (
      <span className="save-state is-failed" role="alert" title={state.message}>
        Not saved: {state.message}
      </span>
    );
  }
  return (
    <span
      className="save-state"
      aria-live="polite"
      data-saving={state.status === "saving" || undefined}
      title={state.status === "saving" ? "Saving draft…" : "Draft saved"}
    >
      <span className="wide-only">{state.status === "saving" ? "Saving draft…" : "Draft saved"}</span>
    </span>
  );
}

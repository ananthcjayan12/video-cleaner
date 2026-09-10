from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    return (ROOT / rel).read_text()


def write(rel: str, text: str) -> None:
    (ROOT / rel).write_text(text)


def replace_once(rel: str, old: str, new: str) -> None:
    text = read(rel)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{rel}: expected exactly one match, found {count}: {old[:100]!r}")
    write(rel, text.replace(old, new, 1))


def replace_all(rel: str, old: str, new: str, minimum: int = 1) -> None:
    text = read(rel)
    count = text.count(old)
    if count < minimum:
        raise RuntimeError(f"{rel}: expected at least {minimum} matches, found {count}: {old[:100]!r}")
    write(rel, text.replace(old, new))


def regex_once(rel: str, pattern: str, replacement: str) -> None:
    text = read(rel)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{rel}: regex expected exactly one match, found {count}: {pattern[:100]!r}")
    write(rel, updated)


# ---------------------------------------------------------------------------
# server/broll.ts — provider model + Google Flow generator
# ---------------------------------------------------------------------------
replace_once(
    "server/broll.ts",
    "export type ImageProvider = 'openai' | 'gemini' | 'grok-cli' | 'codex-cli';\nexport type BrollWorkflowMode",
    "export type ImageProvider = 'openai' | 'gemini' | 'grok-cli' | 'codex-cli';\nexport type VideoProvider = 'grok-cli' | 'google-flow';\nexport type BrollWorkflowMode",
)
replace_once(
    "server/broll.ts",
    "  provider: ImageProvider;\n  countMode: BrollCountMode;",
    "  provider: ImageProvider;\n  videoProvider: VideoProvider;\n  countMode: BrollCountMode;",
)
replace_once(
    "server/broll.ts",
    "  videoFile?: string; videoGeneratedAt?: string; videoModel?: string;\n  displayTemplate?: BrollDisplayTemplate;",
    "  videoFile?: string; videoGeneratedAt?: string; videoModel?: string; videoProvider?: VideoProvider;\n  displayTemplate?: BrollDisplayTemplate;",
)
replace_once(
    "server/broll.ts",
    "export type ImageProviderConfig = { openAiApiKey?: string; openAiModel?: string; geminiApiKey?: string; geminiModel?: string; grokBin?: string; grokModel?: string; grokVideoModel?: string; codexBin?: string; ffmpegBin?: string };",
    "export type ImageProviderConfig = { openAiApiKey?: string; openAiModel?: string; geminiApiKey?: string; geminiModel?: string; grokBin?: string; grokModel?: string; grokVideoModel?: string; gflowBin?: string; gflowProfile?: string; gflowVideoModel?: string; codexBin?: string; ffmpegBin?: string };",
)
replace_once(
    "server/broll.ts",
    "  const provider: ImageProvider = ['openai', 'gemini', 'grok-cli', 'codex-cli'].includes(String(raw?.provider)) ? raw!.provider as ImageProvider : 'gemini';\n  const countMode:",
    "  const provider: ImageProvider = ['openai', 'gemini', 'grok-cli', 'codex-cli'].includes(String(raw?.provider)) ? raw!.provider as ImageProvider : 'gemini';\n  const videoProvider: VideoProvider = ['grok-cli', 'google-flow'].includes(String(raw?.videoProvider)) ? raw!.videoProvider as VideoProvider : 'grok-cli';\n  const countMode:",
)
replace_once(
    "server/broll.ts",
    "  return { workflowMode, provider, countMode,",
    "  return { workflowMode, provider, videoProvider, countMode,",
)
replace_all(
    "server/broll.ts",
    "scene.videoFile = undefined; scene.videoGeneratedAt = undefined; scene.videoModel = undefined;",
    "scene.videoFile = undefined; scene.videoGeneratedAt = undefined; scene.videoModel = undefined; scene.videoProvider = undefined;",
    minimum=2,
)
replace_once(
    "server/broll.ts",
    "export async function deleteBrollScene(workDir: string, plan: BrollPlan, sceneId: string)",
    "export async function updateBrollSettings(workDir: string, plan: BrollPlan, patch: Partial<Pick<BrollPlanSettings, 'videoProvider'>>) { plan.settings = normalizeSettings({ ...plan.settings, ...patch }); await saveBrollPlan(workDir, plan); return plan; }\nexport async function deleteBrollScene(workDir: string, plan: BrollPlan, sceneId: string)",
)
replace_once(
    "server/broll.ts",
    "scene.videoFile = outputPath; scene.videoGeneratedAt = new Date().toISOString(); scene.videoModel = videoModel; await saveBrollPlan(options.workDir, options.plan); return scene;\n}\n\nfunction even(value",
    "scene.videoFile = outputPath; scene.videoGeneratedAt = new Date().toISOString(); scene.videoModel = videoModel; scene.videoProvider = 'grok-cli'; await saveBrollPlan(options.workDir, options.plan); return scene;\n}\n\nexport async function generateBrollVideoWithGoogleFlow(options: { config: ImageProviderConfig; workDir: string; plan: BrollPlan; sceneId: string; regenerationComment?: string }) {\n  const scene = options.plan.scenes.find((candidate) => candidate.id === options.sceneId); if (!scene) throw new Error('B-roll scene not found'); if (!scene.imageFile) throw new Error('Add or generate a B-roll image first'); if (!scene.videoPrompt) throw new Error('Create a Codex video prompt first'); if (!options.config.gflowBin) throw new Error('Google Flow CLI was not found. Install gflow-cli and configure GFLOW_BIN if it is not on PATH.');\n  const brollDir = path.join(options.workDir, 'broll'); const outputPath = path.join(brollDir, `${scene.id}.mp4`); await fs.rm(outputPath, { force: true });\n  const targetDuration = Math.max(2, Math.min(12, scene.sourceEnd - scene.sourceStart)); const flowDuration = targetDuration <= 5 ? 4 : targetDuration <= 7 ? 6 : 8; const videoModel = options.config.gflowVideoModel || 'veo-fast';\n  const requestedChange = options.regenerationComment?.trim() ? `\\n\\nUSER REQUEST FOR THIS REGENERATION:\\n${options.regenerationComment.trim()}` : ''; const motionPrompt = `${scene.videoPrompt}${requestedChange}`.trim();\n  const args = ['video', 'i2v', '--initial-frame', scene.imageFile, motionPrompt, '--model', videoModel, '--duration', String(flowDuration), '--count', '1', '--aspect', resolveSceneAssetAspect(options.plan, scene), '--output', outputPath];\n  if (options.config.gflowProfile?.trim()) args.push('--profile', options.config.gflowProfile.trim());\n  await run(options.config.gflowBin, args, undefined, 1_200_000, { cwd: options.workDir });\n  const stat = await fs.stat(outputPath).catch(() => null); if (!stat?.isFile() || stat.size < 50_000) throw new Error('Google Flow finished without creating a usable MP4. Run `gflow auth status` and verify that the selected Google account has Flow access/credits.');\n  if (options.config.ffmpegBin) await run(options.config.ffmpegBin, ['-v', 'error', '-i', outputPath, '-f', 'null', '-'], undefined, 120000);\n  scene.videoFile = outputPath; scene.videoGeneratedAt = new Date().toISOString(); scene.videoModel = `Google Flow · ${videoModel} · ${flowDuration}s`; scene.videoProvider = 'google-flow'; await saveBrollPlan(options.workDir, options.plan); return scene;\n}\n\nfunction even(value",
)

# ---------------------------------------------------------------------------
# server/index.ts — detect/auth gflow, settings, status, route dispatch
# ---------------------------------------------------------------------------
replace_once(
    "server/index.ts",
    "  generateBrollImage,\n  generateBrollVideoWithGrokCli,",
    "  generateBrollImage,\n  generateBrollVideoWithGoogleFlow,\n  generateBrollVideoWithGrokCli,",
)
replace_once(
    "server/index.ts",
    "  planNeedsPresenterMatte,\n  updateBrollScene,",
    "  planNeedsPresenterMatte,\n  updateBrollScene,\n  updateBrollSettings,",
)
replace_once(
    "server/index.ts",
    "  type ImageProvider,\n} from './broll.js';",
    "  type ImageProvider,\n  type VideoProvider,\n} from './broll.js';",
)
replace_once(
    "server/index.ts",
    "  openAiImageModel?: string; geminiImageModel?: string; grokModel?: string; grokVideoModel?: string;\n  codexBin?: string; grokBin?: string; ffmpegBin?: string; ffprobeBin?: string; projectsDir?: string;",
    "  openAiImageModel?: string; geminiImageModel?: string; grokModel?: string; grokVideoModel?: string; gflowProfile?: string; gflowVideoModel?: string;\n  codexBin?: string; grokBin?: string; gflowBin?: string; ffmpegBin?: string; ffprobeBin?: string; projectsDir?: string;",
)
replace_once(
    "server/index.ts",
    "function providerValue(value: unknown): ImageProvider { return ['openai', 'gemini', 'grok-cli', 'codex-cli'].includes(String(value)) ? value as ImageProvider : 'gemini'; }\nfunction displayTemplateValue",
    "function providerValue(value: unknown): ImageProvider { return ['openai', 'gemini', 'grok-cli', 'codex-cli'].includes(String(value)) ? value as ImageProvider : 'gemini'; }\nfunction videoProviderValue(value: unknown): VideoProvider { return ['grok-cli', 'google-flow'].includes(String(value)) ? value as VideoProvider : 'grok-cli'; }\nfunction displayTemplateValue",
)
replace_once(
    "server/index.ts",
    "  const grokOverride = localSettings.grokBin || process.env.GROK_BIN || '';\n  const ffmpegOverride",
    "  const grokOverride = localSettings.grokBin || process.env.GROK_BIN || '';\n  const gflowOverride = localSettings.gflowBin || process.env.GFLOW_BIN || '';\n  const ffmpegOverride",
)
replace_once(
    "server/index.ts",
    "    grokVideoModel: localSettings.grokVideoModel || process.env.GROK_VIDEO_MODEL || 'grok-imagine-video-1.5',\n    codexBin: codexOverride || await detectBinary('codex'), grokBin: grokOverride || await detectBinary('grok'),",
    "    grokVideoModel: localSettings.grokVideoModel || process.env.GROK_VIDEO_MODEL || 'grok-imagine-video-1.5',\n    gflowProfile: localSettings.gflowProfile || process.env.GFLOW_PROFILE || '',\n    gflowVideoModel: localSettings.gflowVideoModel || process.env.GFLOW_VIDEO_MODEL || 'veo-fast',\n    codexBin: codexOverride || await detectBinary('codex'), grokBin: grokOverride || await detectBinary('grok'), gflowBin: gflowOverride || await detectBinary('gflow'),",
)
replace_once(
    "server/index.ts",
    "  const [codexInstalled, grokInstalled, ffmpegInstalled, ffprobeInstalled] = await Promise.all([canRun(settings.codexBin, ['--version']), canRun(settings.grokBin, ['version']), canRun(settings.ffmpegBin, ['-version']), canRun(settings.ffprobeBin, ['-version'])]);\n  const [codexAuthenticated, capabilities, matting] = await Promise.all([\n    codexInstalled ? canRun(settings.codexBin, ['login', 'status']) : Promise.resolve(false),\n    ffmpegInstalled ? ffmpegCapabilities(settings.ffmpegBin) : Promise.resolve({ videoToolboxDecode: false, h264VideoToolbox: false, hevcVideoToolbox: false }),\n    mattingSystemStatus(ffmpegInstalled ? settings.ffmpegBin : ''),\n  ]);",
    "  const [codexInstalled, grokInstalled, gflowInstalled, ffmpegInstalled, ffprobeInstalled] = await Promise.all([canRun(settings.codexBin, ['--version']), canRun(settings.grokBin, ['version']), canRun(settings.gflowBin, ['--version']), canRun(settings.ffmpegBin, ['-version']), canRun(settings.ffprobeBin, ['-version'])]);\n  const gflowAuthArgs = ['auth', 'status', ...(settings.gflowProfile ? ['--profile', settings.gflowProfile] : [])];\n  const [codexAuthenticated, gflowAuthenticated, capabilities, matting] = await Promise.all([\n    codexInstalled ? canRun(settings.codexBin, ['login', 'status']) : Promise.resolve(false),\n    gflowInstalled ? canRun(settings.gflowBin, gflowAuthArgs) : Promise.resolve(false),\n    ffmpegInstalled ? ffmpegCapabilities(settings.ffmpegBin) : Promise.resolve({ videoToolboxDecode: false, h264VideoToolbox: false, hevcVideoToolbox: false }),\n    mattingSystemStatus(ffmpegInstalled ? settings.ffmpegBin : ''),\n  ]);",
)
replace_once(
    "server/index.ts",
    "    grok: { installed: grokInstalled, path: settings.grokBin || null, model: settings.grokModel || 'CLI default', videoModel: settings.grokVideoModel },\n    ffmpeg:",
    "    grok: { installed: grokInstalled, path: settings.grokBin || null, model: settings.grokModel || 'CLI default', videoModel: settings.grokVideoModel },\n    gflow: { installed: gflowInstalled, authenticated: gflowAuthenticated, path: settings.gflowBin || null, model: settings.gflowVideoModel, profile: settings.gflowProfile || 'default' },\n    ffmpeg:",
)
replace_once(
    "server/index.ts",
    "    brollVideo: { configured: grokInstalled && codexInstalled && codexAuthenticated, provider: 'Grok CLI', model: settings.grokVideoModel, experimental: true },",
    "    videoProviders: {\n      grokCli: { configured: grokInstalled, model: settings.grokVideoModel, experimental: true },\n      googleFlow: { configured: gflowInstalled && gflowAuthenticated, model: settings.gflowVideoModel, profile: settings.gflowProfile || 'default', experimental: true },\n    },\n    brollVideo: { configured: grokInstalled || (gflowInstalled && gflowAuthenticated), provider: 'Grok CLI / Google Flow', model: `${settings.grokVideoModel} / ${settings.gflowVideoModel}`, experimental: true },",
)
replace_once(
    "server/index.ts",
    "codexBin: localSettings.codexBin ?? '', grokBin: localSettings.grokBin ?? '', ffmpegBin:",
    "codexBin: localSettings.codexBin ?? '', grokBin: localSettings.grokBin ?? '', gflowBin: localSettings.gflowBin ?? '', ffmpegBin:",
)
replace_once(
    "server/index.ts",
    "grokModel: localSettings.grokModel ?? '', grokVideoModel: localSettings.grokVideoModel ?? ''",
    "grokModel: localSettings.grokModel ?? '', grokVideoModel: localSettings.grokVideoModel ?? '', gflowProfile: localSettings.gflowProfile ?? '', gflowVideoModel: localSettings.gflowVideoModel ?? ''",
)
replace_once(
    "server/index.ts",
    "['codexBin', 'grokBin', 'ffmpegBin', 'ffprobeBin', 'projectsDir', 'openAiImageModel', 'geminiImageModel', 'grokModel', 'grokVideoModel']",
    "['codexBin', 'grokBin', 'gflowBin', 'ffmpegBin', 'ffprobeBin', 'projectsDir', 'openAiImageModel', 'geminiImageModel', 'grokModel', 'grokVideoModel', 'gflowProfile', 'gflowVideoModel']",
)
replace_once(
    "server/index.ts",
    "app.put('/api/projects/:id/broll/scenes/:sceneId', route(async (req, res) => {",
    "app.put('/api/projects/:id/broll/settings', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const updated = await updateBrollSettings(project.workDir, plan, { videoProvider: videoProviderValue(req.body?.videoProvider) }); brollPlans.set(project.id, updated); await touchProject(project); res.json(updated); }));\napp.put('/api/projects/:id/broll/scenes/:sceneId', route(async (req, res) => {",
)
regex_once(
    "server/index.ts",
    r"  scene = await generateBrollVideoWithGrokCli\(\{ workDir: project\.workDir, plan, sceneId, regenerationComment, config: \{ grokBin: settings\.grokBin, grokModel: settings\.grokModel, grokVideoModel: settings\.grokVideoModel, codexBin: settings\.codexBin, ffmpegBin: settings\.ffmpegBin \} \}\); brollPlans\.set",
    "  const videoProvider = plan.settings.videoProvider || 'grok-cli';\n  scene = videoProvider === 'google-flow'\n    ? await generateBrollVideoWithGoogleFlow({ workDir: project.workDir, plan, sceneId, regenerationComment, config: { gflowBin: settings.gflowBin, gflowProfile: settings.gflowProfile, gflowVideoModel: settings.gflowVideoModel, codexBin: settings.codexBin, ffmpegBin: settings.ffmpegBin } })\n    : await generateBrollVideoWithGrokCli({ workDir: project.workDir, plan, sceneId, regenerationComment, config: { grokBin: settings.grokBin, grokModel: settings.grokModel, grokVideoModel: settings.grokVideoModel, codexBin: settings.codexBin, ffmpegBin: settings.ffmpegBin } }); brollPlans.set",
)

# ---------------------------------------------------------------------------
# src/api.ts — public frontend contract
# ---------------------------------------------------------------------------
replace_once(
    "src/api.ts",
    "export type ImageProvider = 'openai' | 'gemini' | 'grok-cli' | 'codex-cli';\nexport type BrollWorkflowMode",
    "export type ImageProvider = 'openai' | 'gemini' | 'grok-cli' | 'codex-cli';\nexport type VideoProvider = 'grok-cli' | 'google-flow';\nexport type BrollWorkflowMode",
)
replace_once(
    "src/api.ts",
    "  grok: { installed: boolean; path: string | null; model: string; videoModel?: string };\n  ffmpeg:",
    "  grok: { installed: boolean; path: string | null; model: string; videoModel?: string };\n  gflow: { installed: boolean; authenticated: boolean; path: string | null; model: string; profile: string };\n  ffmpeg:",
)
replace_once(
    "src/api.ts",
    "  brollVideo?: { configured: boolean; provider: string; model: string; experimental: boolean };",
    "  videoProviders: { grokCli: { configured: boolean; model: string; experimental: boolean }; googleFlow: { configured: boolean; model: string; profile: string; experimental: boolean } };\n  brollVideo?: { configured: boolean; provider: string; model: string; experimental: boolean };",
)
replace_once(
    "src/api.ts",
    "    codexBin: string; grokBin: string; ffmpegBin: string; ffprobeBin: string; projectsDir: string;\n    imageProvider: string; openAiImageModel: string; geminiImageModel: string; grokModel: string; grokVideoModel?: string;",
    "    codexBin: string; grokBin: string; gflowBin: string; ffmpegBin: string; ffprobeBin: string; projectsDir: string;\n    imageProvider: string; openAiImageModel: string; geminiImageModel: string; grokModel: string; grokVideoModel?: string; gflowProfile?: string; gflowVideoModel?: string;",
)
replace_once(
    "src/api.ts",
    "  workflowMode: BrollWorkflowMode; provider: ImageProvider; countMode:",
    "  workflowMode: BrollWorkflowMode; provider: ImageProvider; videoProvider: VideoProvider; countMode:",
)
replace_once(
    "src/api.ts",
    "  videoFile?: string; videoGeneratedAt?: string; videoModel?: string; displayTemplate?:",
    "  videoFile?: string; videoGeneratedAt?: string; videoModel?: string; videoProvider?: VideoProvider; displayTemplate?:",
)
replace_once(
    "src/api.ts",
    "  getBroll: (id: string) => request<BrollPlan>(`/api/projects/${id}/broll`),\n  updateBrollScene:",
    "  getBroll: (id: string) => request<BrollPlan>(`/api/projects/${id}/broll`),\n  updateBrollSettings: (id: string, patch: { videoProvider: VideoProvider }) => request<BrollPlan>(`/api/projects/${id}/broll/settings`, { method: 'PUT', body: JSON.stringify(patch) }),\n  updateBrollScene:",
)

# ---------------------------------------------------------------------------
# src/App.tsx — provider selector, provider-aware readiness + batching
# ---------------------------------------------------------------------------
replace_once(
    "src/App.tsx",
    "  type ImageProvider,\n  type KeepRange,",
    "  type ImageProvider,\n  type VideoProvider,\n  type KeepRange,",
)
replace_once(
    "src/App.tsx",
    "  workflowMode: 'cleaned-video', provider: 'gemini', countMode:",
    "  workflowMode: 'cleaned-video', provider: 'gemini', videoProvider: 'grok-cli', countMode:",
)
replace_once(
    "src/App.tsx",
    "    openAiImageModel: '', geminiImageModel: '', grokModel: '', grokVideoModel: '',\n    codexBin: '', grokBin: '', ffmpegBin:",
    "    openAiImageModel: '', geminiImageModel: '', grokModel: '', grokVideoModel: '', gflowProfile: '', gflowVideoModel: '',\n    codexBin: '', grokBin: '', gflowBin: '', ffmpegBin:",
)
replace_once(
    "src/App.tsx",
    "codexBin: result.overrides?.codexBin ?? '', grokBin: result.overrides?.grokBin ?? '', ffmpegBin:",
    "codexBin: result.overrides?.codexBin ?? '', grokBin: result.overrides?.grokBin ?? '', gflowBin: result.overrides?.gflowBin ?? '', ffmpegBin:",
)
replace_once(
    "src/App.tsx",
    "grokModel: result.overrides?.grokModel ?? '', grokVideoModel: result.overrides?.grokVideoModel ?? '',",
    "grokModel: result.overrides?.grokModel ?? '', grokVideoModel: result.overrides?.grokVideoModel ?? '', gflowProfile: result.overrides?.gflowProfile ?? '', gflowVideoModel: result.overrides?.gflowVideoModel ?? '',",
)
replace_once(
    "src/App.tsx",
    "  async function pick() {",
    "  async function changeVideoProvider(provider: VideoProvider) {\n    setBrollSettings((current) => ({ ...current, videoProvider: provider }));\n    if (!project || !broll) return;\n    try { setError(''); const updated = await api.updateBrollSettings(project.id, { videoProvider: provider }); applyBrollPlan(updated); setStatus(`Video provider changed to ${videoProviderLabel(provider)}. Saved locally ✓`); }\n    catch (err) { setError(message(err)); setBrollSettings(broll.settings); }\n  }\n\n  async function pick() {",
)
regex_once(
    "src/App.tsx",
    r"  async function createSceneVideo\(scene: BrollScene, regenerationComment\?: string\) \{.*?\n  \}\n\n  async function finalizeParallelPlan",
    "  async function createSceneVideo(scene: BrollScene, regenerationComment?: string) {\n    if (!project || brollGenerating || generatingAll) return;\n    const provider = broll?.settings.videoProvider || brollSettings.videoProvider || 'grok-cli'; const label = videoProviderLabel(provider);\n    if (!videoProviderReady(system, provider)) { setError(`${label} is not ready. Check Settings and authentication.`); return; }\n    if (!scene.videoPrompt && !system?.codex.authenticated) { setError('Codex must be authenticated to create a video motion prompt first.'); return; }\n    try { setError(''); setBrollGenerating(scene.id); setStatus(`${scene.videoPrompt ? 'Creating' : 'Codex is prompting, then creating'} video for ${scene.title} with ${label}…`); const saved = await saveScene(scene); const result = await api.createBrollVideo(project.id, saved.id, regenerationComment?.trim() || undefined); replaceScene(result.scene); setStatus(`B-roll video ready for ${result.scene.title} via ${label}. Saved locally ✓`); }\n    catch (err) { setError(message(err)); } finally { setBrollGenerating(null); }\n  }\n\n  async function finalizeParallelPlan",
)
regex_once(
    "src/App.tsx",
    r"  async function runVideoBatch\(scenes: BrollScene\[], mode: 'all' \| 'missing'\) \{.*?\n  \}\n\n  async function generateAllVideos",
    "  async function runVideoBatch(scenes: BrollScene[], mode: 'all' | 'missing') {\n    if (!project || !broll || generatingAll || brollGenerating) return;\n    const provider = broll.settings.videoProvider || 'grok-cli'; const providerName = videoProviderLabel(provider);\n    if (!videoProviderReady(system, provider)) { setError(`${providerName} is not ready. Check Settings and authentication.`); return; }\n    if (!scenes.length) { setStatus(mode === 'missing' ? 'All eligible B-roll videos are already present.' : 'Generate or add at least one B-roll image before creating videos.'); return; }\n    const profile = videoConcurrencyProfile(provider); const concurrency = resolveConcurrency(videoConcurrency, profile.defaultConcurrency, profile.maxConcurrency);\n    if (!window.confirm(`${mode === 'missing' ? 'Create the' : 'Create'} ${scenes.length} ${mode === 'missing' ? 'missing ' : ''}B-roll video${scenes.length === 1 ? '' : 's'} with ${providerName} using up to ${concurrency} parallel worker${concurrency === 1 ? '' : 's'}?${provider === 'google-flow' ? ' Each generation uses your signed-in Google Flow account credits.' : ''}`)) return;\n    setGeneratingAll(true); setParallelRunning([]); setError('');\n    try {\n      const savedScenes: BrollScene[] = []; for (const scene of scenes) savedScenes.push(await saveScene(scene));\n      const failures = await runParallel(savedScenes, concurrency, async (scene) => {\n        setParallelRunning((current) => current.includes(scene.id) ? current : [...current, scene.id]);\n        try { const result = await withTransientRetry(() => api.createBrollVideo(project.id, scene.id), 3); replaceScene(result.scene); }\n        finally { setParallelRunning((current) => current.filter((id) => id !== scene.id)); }\n      }, (completed, total, failed) => setStatus(`Creating B-roll videos with ${providerName} · ${completed}/${total} finished${failed ? ` · ${failed} failed` : ''}`));\n      await finalizeParallelPlan(savedScenes); const succeeded = savedScenes.length - failures.length;\n      setStatus(`Video generation complete with ${providerName}: ${succeeded}/${savedScenes.length} succeeded. Project saved locally ✓`);\n      if (failures.length) setError(`${failures.length} video job${failures.length === 1 ? '' : 's'} failed. ${failures[0].error}`);\n    } catch (err) { setError(message(err)); }\n    finally { setParallelRunning([]); setGeneratingAll(false); }\n  }\n\n  async function generateAllVideos",
)
replace_once(
    "src/App.tsx",
    "changeSceneAspect={changeSceneAspect} previewScene=",
    "changeSceneAspect={changeSceneAspect} changeVideoProvider={changeVideoProvider} previewScene=",
)
replace_once(
    "src/App.tsx",
    "<SystemItem label=\"B-roll Video\" ok={Boolean(system?.brollVideo?.configured)} detail={system?.brollVideo?.configured ? `${system.brollVideo.provider} · ${system.brollVideo.model}` : 'Codex + Grok CLI required'} />",
    "<SystemItem label=\"Grok Video\" ok={Boolean(system?.videoProviders?.grokCli.configured)} detail={system?.videoProviders?.grokCli.configured ? system.videoProviders.grokCli.model : 'Grok CLI not detected'} /><SystemItem label=\"Google Flow\" ok={Boolean(system?.videoProviders?.googleFlow.configured)} detail={system?.videoProviders?.googleFlow.configured ? `${system.videoProviders.googleFlow.model} · profile ${system.videoProviders.googleFlow.profile}` : system?.gflow?.installed ? 'Installed · sign in with gflow auth login' : 'gflow CLI not detected'} />",
)
replace_once(
    "src/App.tsx",
    "      <label>Grok image-to-video model<input value={form.grokVideoModel} onChange={(e) => setForm({ ...form, grokVideoModel: e.target.value })} placeholder={system?.brollVideo?.model || 'grok-imagine-video-1.5'} /></label>\n      <label>FFmpeg binary",
    "      <label>Grok image-to-video model<input value={form.grokVideoModel} onChange={(e) => setForm({ ...form, grokVideoModel: e.target.value })} placeholder={system?.videoProviders?.grokCli.model || 'grok-imagine-video-1.5'} /></label>\n      <label>Google Flow / gflow binary<input value={form.gflowBin} onChange={(e) => setForm({ ...form, gflowBin: e.target.value })} placeholder=\"Auto detect `gflow` from PATH\" /></label>\n      <label>Google Flow profile<input value={form.gflowProfile} onChange={(e) => setForm({ ...form, gflowProfile: e.target.value })} placeholder={system?.videoProviders?.googleFlow.profile || 'default'} /></label>\n      <label>Google Flow video model<input value={form.gflowVideoModel} onChange={(e) => setForm({ ...form, gflowVideoModel: e.target.value })} placeholder={system?.videoProviders?.googleFlow.model || 'veo-fast'} /></label>\n      <label>FFmpeg binary",
)
replace_once(
    "src/App.tsx",
    "function BrollWorkspace({ project, system, plan, settings, setSettings, drafts, changeDraft, changeSceneLayout, changeSceneAspect, previewScene,",
    "function BrollWorkspace({ project, system, plan, settings, setSettings, drafts, changeDraft, changeSceneLayout, changeSceneAspect, changeVideoProvider, previewScene,",
)
replace_once(
    "src/App.tsx",
    "const providerIsReady = providerReady(system, settings.provider); const imageProfile = imageConcurrencyProfile(settings.provider); const imageConcurrencyValue = imageConcurrency === 0 ? 0 : Math.min(imageConcurrency, imageProfile.maxConcurrency); const videoConcurrencyValue = videoConcurrency === 0 ? 0 : Math.min(videoConcurrency, 3);",
    "const providerIsReady = providerReady(system, settings.provider); const videoProvider = (settings.videoProvider || 'grok-cli') as VideoProvider; const videoProviderIsReady = videoProviderReady(system, videoProvider); const imageProfile = imageConcurrencyProfile(settings.provider); const videoProfile = videoConcurrencyProfile(videoProvider); const imageConcurrencyValue = imageConcurrency === 0 ? 0 : Math.min(imageConcurrency, imageProfile.maxConcurrency); const videoConcurrencyValue = videoConcurrency === 0 ? 0 : Math.min(videoConcurrency, videoProfile.maxConcurrency);",
)
replace_all(
    "src/App.tsx",
    "!system?.brollVideo?.configured",
    "!videoProviderIsReady",
    minimum=3,
)
replace_once(
    "src/App.tsx",
    "</select></label><label>Parallel images<select value={imageConcurrencyValue}",
    "</select></label><label>Video provider<select value={videoProvider} onChange={(e) => void changeVideoProvider(e.target.value as VideoProvider)} disabled={busy || generatingAll || !!generating}><option value=\"grok-cli\">Grok CLI</option><option value=\"google-flow\">Google Flow · Veo</option></select></label><label>Parallel images<select value={imageConcurrencyValue}",
)
replace_once(
    "src/App.tsx",
    "<label>Parallel videos<select value={videoConcurrencyValue} onChange={(e) => setVideoConcurrency(Number(e.target.value))}><option value=\"0\">Auto (2)</option>{[1, 2, 3].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>",
    "<label>Parallel videos<select value={videoConcurrencyValue} onChange={(e) => setVideoConcurrency(Number(e.target.value))}><option value=\"0\">Auto ({videoProfile.defaultConcurrency})</option>{Array.from({ length: videoProfile.maxConcurrency }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>",
)
replace_once(
    "src/App.tsx",
    "<span>{providerLabel(plan.settings.provider)}</span><span>{plan.settings.workflowMode}</span>",
    "<span>{providerLabel(plan.settings.provider)}</span><span>Video: {videoProviderLabel(plan.settings.videoProvider || 'grok-cli')}</span><span>{plan.settings.workflowMode}</span>",
)
replace_once(
    "src/App.tsx",
    "{scene.videoFile && <span className=\"videoBadge\">VIDEO</span>}{scene.videoModel && <span>{scene.videoModel}</span>}",
    "{scene.videoFile && <span className=\"videoBadge\">VIDEO</span>}{scene.videoProvider && <span>{videoProviderLabel(scene.videoProvider)}</span>}{scene.videoModel && <span>{scene.videoModel}</span>}",
)
replace_once(
    "src/App.tsx",
    "disabled={busy || generatingAll || !!generating || !scene.imageFile || !videoProviderIsReady}",
    "disabled={busy || generatingAll || !!generating || !scene.imageFile || !videoProviderReady(system, plan.settings.videoProvider || 'grok-cli')}",
)
replace_once(
    "src/App.tsx",
    "function resolveConcurrency(requested: number, defaultConcurrency: number, maxConcurrency: number)",
    "function videoConcurrencyProfile(provider: VideoProvider) { return provider === 'google-flow' ? { defaultConcurrency: 1, maxConcurrency: 1 } : { defaultConcurrency: 2, maxConcurrency: 3 }; }\nfunction videoProviderReady(system: SystemStatus | null, provider: VideoProvider) { if (!system) return false; return provider === 'google-flow' ? Boolean(system.videoProviders?.googleFlow.configured) : Boolean(system.videoProviders?.grokCli.configured); }\nfunction videoProviderLabel(provider: VideoProvider) { return provider === 'google-flow' ? 'Google Flow' : 'Grok CLI'; }\nfunction resolveConcurrency(requested: number, defaultConcurrency: number, maxConcurrency: number)",
)

# ---------------------------------------------------------------------------
# .env.example — local Flow CLI configuration
# ---------------------------------------------------------------------------
replace_once(
    ".env.example",
    "GROK_VIDEO_MODEL=grok-imagine-video-1.5\n\n# Codex CLI",
    "GROK_VIDEO_MODEL=grok-imagine-video-1.5\n\n# Google Flow video provider via the unofficial gflow-cli browser automation.\n# Install: uv tool install gflow-cli\n# Login once: gflow auth login --browser chrome\n# Leave GFLOW_BIN blank to auto-detect `gflow` from PATH.\nGFLOW_BIN=\nGFLOW_PROFILE=\nGFLOW_VIDEO_MODEL=veo-fast\n\n# Codex CLI",
)

print("Google Flow video-provider patch applied successfully")

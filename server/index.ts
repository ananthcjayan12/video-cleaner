import { listStickFacePacks, loadStickDraft, makeStickDraft, renderStickReel, saveStickDraft, STICK_THEMES, stickMusicPath, type StickRender } from './stick-reel.js';
import { planStickReelWithAi } from './stick-planner.js';
import { DEFAULT_SCRIPT_ENGINE, loadStudioSettings, MALE_VOICES, narrateScript, narrationJobs, newNarrationJob, previewVoice, saveStudioSettings, writeStickScript, type StickScript } from './stick-narration.js';
import { EMOTIONS } from './emotion-sfx.js';
import { MOTION_SOUNDS, motionSoundPath } from './motion-sfx.js';
import { colorVideoFilter } from './color.js';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { loadEditorMedia, importEditorMedia, resolveEditorMedia, type EditorMediaKind } from './editor-media.js';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import dotenv from 'dotenv';
import {
  BROLL_DISPLAY_TEMPLATES,
  buildBrollOverlayFilter,
  createBrollPlan,
  createVideoPrompt,
  deleteBrollScene,
  displayTemplateNeedsPresenterMatte,
  generateBrollImage,
  generateBrollImagesWithChatGpt,
  fixSceneForMetaPolicy,
  generateBrollVideoWithGoogleFlow,
  generateBrollVideoWithGrokCli,
  generateBrollVideoWithMagnific,
  importBrollImage,
  importBrollVideo,
  listGoogleFlowProjectVideos,
  loadBrollPlan,
  saveBrollPlan,
  planNeedsPresenterMatte,
  resolveMagnificVideoConfig,
  setStillEffect,
  updateBrollScene,
  updateBrollSettings,
  type BrollDisplayTemplate,
  type BrollPlan,
  type BrollPlanSettings,
  type ImageProvider,
  type VideoProvider,
} from './broll.js';
import {
  addEmotionCue,
  createMotionPlan,
  deleteEmotionCue,
  deleteMotionScene,
  emptyMotionPlan,
  generateMotionScene,
  loadMotionPlan,
  normalizeMotionSettings,
  planEmotionSounds,
  saveMotionPlan,
  updateEmotionCue,
  updateMotionScene,
  updateMotionSettings,
  type MotionPlan,
  type MotionScenePatch,
  type MotionSettings,
} from './motion.js';
import { addMotionTemplate, deleteMotionTemplate, listMotionTemplates, motionTemplatePath, MOTION_TEMPLATE_MIME, updateMotionTemplate } from './motion-templates.js';
import { ensurePresenterMatte, mattingSystemStatus, presenterMatteStatus, resolvePythonBin, type PresenterMatteSpecInput } from './presenter.js';
import { exportProjectZip, normalizeProjectExportOptions } from './project-export.js';
import { buildEditorRender } from './editor-render.js';
import { formatMetaFinding, metaTextGuidelinesPrompt, scanMetaText } from './meta-guidelines.js';
import { availableAgyModels, availableCodexModels, DEFAULT_ANTHROPIC_MODEL, generateStructuredText, listProviderModels, type ModelKind, TEXT_PROVIDERS, type TextModelChoice, type TextProvider } from './text-models.js';
import { findClaims } from './claims.js';
import { NICHE_PACKS, nichePack, packLook, packPreview, packWriterNotes } from './niche-packs.js';
import { nicheValue, weeklyIdeas, IDEAS, NICHES } from './ideas.js';
import { addSubscriber, notify, removeSubscriber, vapidKeys } from './push.js';
import { currentProfile, readUsage, recordUsage, runWithUsage, summarizeUsage, usageContext, usageFile, withTask, type EngineProfile } from './usage.js';
import { addExtraReels, limitThisMonth, addMember, allowedProfiles, createWorkspace, effectiveProfile, loadWorkspaces, memberAuth, memberRoute, normalizeUsername, PERSONAL_WORKSPACE, reelsThisMonth, removeMember, saveWorkspaces, sessionUsername, updateWorkspace, type SessionUser, type Workspace } from './workspaces.js';
import { verifyAccessJwt } from './access.js';
import { DEFAULT_PICTURES_ENGINE } from './chatgpt-images.js';
import { checkCredentials, issueSession, loadAuth, LOGIN_PAGE, LoginLimiter, readCookie, SESSION_COOKIE, SESSION_DAYS, verifySession } from './auth.js';
import { appendChunk, completedUploadPath, createUpload, readUpload, type UploadKind } from './uploads.js';
import { AUTO_COMPOSITE_SCRIPT, AUTO_EDIT_SCRIPT, keepIndexRanges, makePreviewVideo, warmCaptionRenderer, newAutoJob, placeBroll, renderCaptionLayer, renderThumbnail, runPython, WHOOSH, type AutoJob, type AutoOptions, type AutoStageId, type EditRange, type ReelPackage } from './auto-reel.js';
import { buildPackagePrompt, cleanPackage, extractCandidateFrames, FRAME_COUNT, framePaths, PACKAGE_SCHEMA } from './reel-package.js';
import { buildCaptionPhrases, type CaptionWordIn } from './captions.js';
import { buildCleanPrompt, cleanIntensityValue, keptDuration, targetDurationValue, targetFeedback, type CleanNotes } from './clean.js';
import { DEFAULT_GEMINI_STT_MODEL, sttProviderValue, transcribeAudio, type SttProvider } from './stt.js';
import { generateProjectThumbnail, loadThumbnailState, replaceThumbnailReferences, thumbnailImageFile, thumbnailReferenceFile, thumbnailStateView } from './thumbnail.js';
import {
  atomicWriteJson,
  clipAtTimelineTime,
  loadProjectDirectory,
  loadProjectSnapshot,
  projectClips,
  configureVideoDurationProbe,
  reconcileBrollFiles,
  resolveBrollAssetPath,
  saveProject,
  scanProjects,
  splitTimelineRange,
  summarizeProject,
  syncProjectTimeline,
  type KeepRange,
  type MediaProfile,
  type Project,
  type ProjectClip,
  type Word,
} from './project-store.js';

dotenv.config({ path: path.resolve('.env.local') });
dotenv.config({ path: path.resolve('.env') });

type LocalSettings = {
  elevenLabsApiKey?: string; openAiApiKey?: string; geminiApiKey?: string; imageProvider?: ImageProvider;
  // API engines for customer ("api") accounts.
  anthropicApiKey?: string; apiTextModel?: string; apiEffort?: string;
  sttProvider?: SttProvider; geminiSttModel?: string;
  // Per-task AI engine like story-reels: provider + model + effort. Pictures = ChatGPT in Chrome.
  cleanEffort?: string; planningEffort?: string; picturesProvider?: 'claude' | 'codex'; picturesModel?: string; picturesEffort?: string;
  // Stick-figure narration script writer (own engine so it can differ from Planning).
  scriptProvider?: TextProvider; scriptModel?: string; scriptEffort?: string;
  accessTeamDomain?: string; accessAud?: string; accessAllowedEmails?: string;
  openAiImageModel?: string; geminiImageModel?: string; grokModel?: string; grokVideoModel?: string; gflowProfile?: string; gflowVideoModel?: string;
  magnificApiKey?: string; magnificVideoModel?: string; magnificVideoEndpoint?: string;
  // Legacy names from the initial Magnific integration; retained for automatic migration.
  freepikApiKey?: string; freepikVideoModel?: string; freepikVideoEndpoint?: string;
  cleanProvider?: TextProvider; cleanModel?: string; planningProvider?: TextProvider; planningModel?: string; codexModel?: string; agyBin?: string;
  codexBin?: string; claudeBin?: string; grokBin?: string; gflowBin?: string; ffmpegBin?: string; ffprobeBin?: string; projectsDir?: string;
};
type FfmpegCapabilities = { videoToolboxDecode: boolean; h264VideoToolbox: boolean; hevcVideoToolbox: boolean };
type ExportJob = {
  state: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'; progress: number; outTime: string; speed: string; frame: number;
  outputPath?: string; encoder?: string; error?: string; startedAt?: number; checkpointCompleted?: number; checkpointTotal?: number; resumable?: boolean; resumed?: boolean; stopRequested?: boolean;
};

const CONFIG_DIR = path.join(os.homedir(), '.video-cleaner');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const app = express();
const projects = new Map<string, Project>();
const brollPlans = new Map<string, BrollPlan>();
const motionPlans = new Map<string, MotionPlan>();
const exportJobs = new Map<string, ExportJob>();
const exportProcesses = new Map<string, ReturnType<typeof spawn>>();
const capabilityCache = new Map<string, FfmpegCapabilities>();
let localSettings: LocalSettings = {};
// Requests from outside this computer (the Cloudflare tunnel) need a login: the app's own username + password session,
// or (optional) a valid Cloudflare Access token. Local requests are not affected.
const loginLimiter = new LoginLimiter();
/**
 * Who is calling. Requests on this computer are the owner. Remote requests need a session: the owner's login
 * (auth.json), a customer login (workspaces.json, limited to their own reels), or an optional Cloudflare Access token.
 */
async function sessionUser(req: express.Request): Promise<SessionUser | null> {
  if (!isRemoteRequest(req)) return { username: 'local', role: 'admin' };
  const token = readCookie(req.headers.cookie, SESSION_COOKIE); const name = sessionUsername(token);
  const auth = await loadAuth();
  if (auth && name === auth.username && verifySession(auth, token)) return { username: auth.username, role: 'admin' };
  if (name) {
    const member = (await loadWorkspaces()).members.find((candidate) => candidate.username === name);
    if (member && verifySession(memberAuth(member), token)) return { username: member.username, role: 'member', workspaceId: member.workspaceId };
  }
  const teamDomain = localSettings.accessTeamDomain || process.env.CF_ACCESS_TEAM_DOMAIN || '';
  const aud = localSettings.accessAud || process.env.CF_ACCESS_AUD || '';
  const jwt = req.header('Cf-Access-Jwt-Assertion');
  if (jwt && teamDomain && aud) {
    const allowedEmails = (localSettings.accessAllowedEmails || process.env.CF_ACCESS_ALLOWED_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean);
    if (await verifyAccessJwt(jwt, { teamDomain, aud, allowedEmails }).then(() => true, () => false)) return { username: 'cloudflare-access', role: 'admin' };
  }
  return null;
}
/** Home-screen app files (icon, manifest, service worker) must load before login. */
const PUBLIC_FILES = /^\/(manifest\.webmanifest|sw\.js|icons\/[a-z0-9._-]+\.png|apple-touch-icon\.png)$/;
const userOf = (res: express.Response) => res.locals.user as SessionUser;
const isAdmin = (res: express.Response) => userOf(res)?.role === 'admin';
app.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/api/login' || PUBLIC_FILES.test(req.path)) return next();
  void (async () => {
    const user = await sessionUser(req);
    if (!user) {
      if (!await loadAuth()) return void res.status(403).json({ error: 'Remote login is not set up yet. On the computer, run: node scripts/set-login.mjs' });
      if (req.path.startsWith('/api/')) return void res.status(401).json({ error: 'Please log in again.', login: true });
      return void res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    res.locals.user = user;
    if (user.role === 'member' && req.path.startsWith('/api/')) {
      const access = memberRoute(req.method, req.path);
      if (!access.allowed) return void res.status(403).json({ error: 'This is not available for your account.' });
      if (access.projectId) {
        const project = projects.get(access.projectId);
        if (!project || projectWorkspaceId(project) !== user.workspaceId) return void res.status(404).json({ error: 'Reel not found.' });
      }
    }
    next();
  })().catch((error) => res.status(500).json({ error: String(error) }));
});
const projectWorkspaceId = (project: Project) => project.workspaceId || PERSONAL_WORKSPACE.id;
async function workspaceFor(id: string | undefined): Promise<Workspace> {
  const data = await loadWorkspaces(); return data.workspaces.find((w) => w.id === (id || PERSONAL_WORKSPACE.id)) ?? { ...PERSONAL_WORKSPACE };
}
/** Usage file + engine profile for everything that runs for this project (AI calls check the profile themselves). */
/** The account's field look (fonts, colours, picture style, wording) for this reel. */
async function projectPack(project: Project) { return nichePack((await workspaceFor(projectWorkspaceId(project))).niche); }
async function projectUsageContext(project: Project) {
  const settings = await resolvedSettings();
  return { file: usageFile(project.workDir), profile: effectiveProfile(await workspaceFor(project.workspaceId)), apiTextModel: settings.apiTextModel };
}
app.use(express.json({ limit: '1mb' }));
// Everything that runs for a project (AI calls, pictures, renders) is metered into that project and runs with its account's engines.
app.use('/api/projects/:id', (req, res, next) => {
  const project = projects.get(String(req.params.id)); if (!project) return next();
  projectUsageContext(project).then((context) => runWithUsage(context, next), (error) => res.status(500).json({ error: error instanceof Error ? error.message : String(error) }));
});
app.get('/login', (_req, res) => { res.set('Cache-Control', 'no-store').type('html').send(LOGIN_PAGE); });
app.post('/api/login', (req, res) => {
  void (async () => {
    const client = req.header('cf-connecting-ip') || req.ip || 'unknown';
    if (loginLimiter.blocked(client)) return void res.status(429).json({ error: 'Too many attempts. Wait 15 minutes and try again.' });
    const auth = await loadAuth();
    if (!auth) return void res.status(403).json({ error: 'Login is not set up yet. On the computer, run: node scripts/set-login.mjs' });
    const username = String(req.body?.username ?? ''); const password = String(req.body?.password ?? '');
    // The owner first; otherwise a customer login with that username.
    const member = (await loadWorkspaces()).members.find((candidate) => candidate.username === normalizeUsername(username));
    const signer = await checkCredentials(auth, username, password) ? auth : member && await checkCredentials(memberAuth(member), username, password) ? memberAuth(member) : null;
    if (!signer) { loginLimiter.fail(client); return void res.status(401).json({ error: 'Wrong username or password.' }); }
    loginLimiter.clear(client);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${issueSession(signer)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
    res.json({ ok: true });
  })().catch((error) => res.status(500).json({ error: String(error) }));
});
app.post('/api/logout', (_req, res) => { res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`); res.json({ ok: true }); });

const EDL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['keepRanges', 'notes'],
  properties: {
    keepRanges: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['startWordId', 'endWordId', 'reason'], properties: { startWordId: { type: 'string' }, endWordId: { type: 'string' }, reason: { type: 'string' } } } },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

async function run(command: string, args: string[], stdin?: string, timeoutMs = 0) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = ''; let stderr = ''; let timer: NodeJS.Timeout | undefined;
    if (timeoutMs > 0) timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${command} timed out`)); }, timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += chunk.toString())); child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', (error) => { if (timer) clearTimeout(timer); reject(error); });
    child.on('close', (code) => { if (timer) clearTimeout(timer); if (code === 0) resolve({ stdout, stderr }); else reject(new Error(`${command} failed (${code})\n${stderr || stdout}`)); });
    child.stdin.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'EPIPE') reject(error); });
    if (stdin) child.stdin.end(stdin); else child.stdin.end();
  });
}

async function loadSettings() {
  try {
    localSettings = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8')) as LocalSettings;
    const hasLegacyNames = Boolean(localSettings.freepikApiKey || localSettings.freepikVideoModel || localSettings.freepikVideoEndpoint);
    const magnific = resolveMagnificVideoConfig(localSettings.magnificVideoModel || localSettings.freepikVideoModel, localSettings.magnificVideoEndpoint || localSettings.freepikVideoEndpoint);
    if (hasLegacyNames || magnific.migratedLegacyEndpoint) {
      localSettings.magnificApiKey ||= localSettings.freepikApiKey;
      localSettings.magnificVideoModel = magnific.model;
      localSettings.magnificVideoEndpoint = magnific.migratedLegacyEndpoint ? undefined : magnific.endpoint;
      delete localSettings.freepikApiKey; delete localSettings.freepikVideoModel; delete localSettings.freepikVideoEndpoint;
      await saveSettings();
    }
  } catch { localSettings = {}; }
}
async function saveSettings() { await fs.mkdir(CONFIG_DIR, { recursive: true }); await fs.writeFile(CONFIG_PATH, JSON.stringify(localSettings, null, 2), { mode: 0o600 }); }
async function detectBinary(name: string) {
  try {
    const { stdout } = await run(process.platform === 'win32' ? 'where' : 'which', [name], undefined, 3000);
    const detected = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (detected) return detected;
  } catch { /* Try common user-local install locations below. */ }
  if (process.platform !== 'win32') {
    const userLocalBinary = path.join(os.homedir(), '.local', 'bin', name);
    try { await fs.access(userLocalBinary); return userLocalBinary; } catch { /* Not installed here. */ }
  }
  return '';
}
function providerValue(value: unknown): ImageProvider { return ['openai', 'gemini', 'grok-cli', 'codex-cli', 'chatgpt-browser'].includes(String(value)) ? value as ImageProvider : 'gemini'; }
function textProviderValue(value: unknown): TextProvider { return TEXT_PROVIDERS.includes(value as TextProvider) ? value as TextProvider : 'claude-cli'; }
function videoProviderValue(value: unknown): VideoProvider { return ['grok-cli', 'google-flow', 'magnific'].includes(String(value)) ? value as VideoProvider : 'grok-cli'; }
function displayTemplateValue(value: unknown): BrollDisplayTemplate {
  const candidate = String(value || 'full-frame') as BrollDisplayTemplate;
  return BROLL_DISPLAY_TEMPLATES.some((template) => template.id === candidate) ? candidate : 'full-frame';
}

// Remotion renders motion graphics in headless Chromium. Prefer a browser that is already installed
// so nothing has to be downloaded; returning '' lets Remotion fetch its own headless shell instead.
async function detectChromeBin() {
  const configured = process.env.CHROME_BIN || '';
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : process.platform === 'win32'
      ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const candidate of [configured, ...candidates].filter(Boolean)) if (await fs.stat(candidate).then((stat) => stat.isFile()).catch(() => false)) return candidate;
  return '';
}
async function resolvedSettings() {
  const codexOverride = localSettings.codexBin || process.env.CODEX_BIN || '';
  const claudeOverride = localSettings.claudeBin || process.env.CLAUDE_BIN || '';
  const agyOverride = localSettings.agyBin || process.env.AGY_BIN || '';
  const grokOverride = localSettings.grokBin || process.env.GROK_BIN || '';
  const gflowOverride = localSettings.gflowBin || process.env.GFLOW_BIN || '';
  const ffmpegOverride = localSettings.ffmpegBin || process.env.FFMPEG_BIN || '';
  const ffprobeOverride = localSettings.ffprobeBin || process.env.FFPROBE_BIN || '';
  const magnific = resolveMagnificVideoConfig(
    localSettings.magnificVideoModel || localSettings.freepikVideoModel || process.env.MAGNIFIC_VIDEO_MODEL || process.env.FREEPIK_VIDEO_MODEL,
    localSettings.magnificVideoEndpoint || localSettings.freepikVideoEndpoint || process.env.MAGNIFIC_VIDEO_ENDPOINT || process.env.FREEPIK_VIDEO_ENDPOINT,
  );
  return {
    elevenLabsApiKey: localSettings.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY || '',
    openAiApiKey: localSettings.openAiApiKey || process.env.OPENAI_API_KEY || '',
    geminiApiKey: localSettings.geminiApiKey || process.env.GEMINI_API_KEY || '',
    anthropicApiKey: localSettings.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '',
    apiTextModel: localSettings.apiTextModel || process.env.API_TEXT_MODEL || DEFAULT_ANTHROPIC_MODEL,
    apiEffort: localSettings.apiEffort || 'medium',
    // Gemini is the default transcriber when a Gemini key exists; ElevenLabs Scribe stays available.
    sttProvider: sttProviderValue(localSettings.sttProvider || process.env.STT_PROVIDER, (localSettings.geminiApiKey || process.env.GEMINI_API_KEY) ? 'gemini' : 'elevenlabs'),
    geminiSttModel: localSettings.geminiSttModel || process.env.GEMINI_STT_MODEL || DEFAULT_GEMINI_STT_MODEL,
    magnificApiKey: localSettings.magnificApiKey || localSettings.freepikApiKey || process.env.MAGNIFIC_API_KEY || process.env.FREEPIK_API_KEY || '',
    imageProvider: providerValue(localSettings.imageProvider || process.env.IMAGE_PROVIDER),
    cleanProvider: textProviderValue(localSettings.cleanProvider || process.env.CLEAN_PROVIDER), cleanModel: localSettings.cleanModel || process.env.CLEAN_MODEL || '',
    cleanEffort: localSettings.cleanEffort || 'medium', planningEffort: localSettings.planningEffort || 'medium',
    scriptProvider: textProviderValue(localSettings.scriptProvider || 'claude-cli'), scriptModel: localSettings.scriptModel ?? DEFAULT_SCRIPT_ENGINE.model, scriptEffort: localSettings.scriptEffort || DEFAULT_SCRIPT_ENGINE.effort,
    picturesProvider: (localSettings.picturesProvider === 'codex' ? 'codex' : 'claude') as 'claude' | 'codex',
    picturesModel: localSettings.picturesModel ?? (localSettings.picturesProvider === 'codex' ? '' : DEFAULT_PICTURES_ENGINE.model), picturesEffort: localSettings.picturesEffort || DEFAULT_PICTURES_ENGINE.effort,
    planningProvider: textProviderValue(localSettings.planningProvider || process.env.BROLL_PLANNING_PROVIDER), planningModel: localSettings.planningModel || process.env.BROLL_PLANNING_MODEL || '',
    codexModel: localSettings.codexModel || process.env.CODEX_MODEL || '',
    openAiImageModel: localSettings.openAiImageModel || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
    geminiImageModel: localSettings.geminiImageModel || process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
    grokModel: localSettings.grokModel || process.env.GROK_IMAGE_MODEL || '',
    grokVideoModel: localSettings.grokVideoModel || process.env.GROK_VIDEO_MODEL || 'grok-imagine-video-1.5',
    gflowProfile: localSettings.gflowProfile || process.env.GFLOW_PROFILE || '',
    gflowVideoModel: localSettings.gflowVideoModel || process.env.GFLOW_VIDEO_MODEL || 'veo-fast',
    magnificVideoModel: magnific.model,
    magnificVideoEndpoint: magnific.endpoint,
    codexBin: codexOverride || await detectBinary('codex'), claudeBin: claudeOverride || await detectBinary('claude'), agyBin: agyOverride || await detectBinary('agy'), grokBin: grokOverride || await detectBinary('grok'), gflowBin: gflowOverride || await detectBinary('gflow'),
    ffmpegBin: ffmpegOverride || await detectBinary('ffmpeg'), ffprobeBin: ffprobeOverride || await detectBinary('ffprobe'),
    projectsDir: localSettings.projectsDir || process.env.PROJECTS_DIR || path.join(os.homedir(), 'VideoCleaner', 'projects'),
  };
}

type Settings = Awaited<ReturnType<typeof resolvedSettings>>;
/**
 * Text engines for the current account. In-house accounts use the engines chosen in Settings (CLIs on this
 * computer's subscriptions); API accounts always use the Claude API, whatever Settings say.
 */
function textEngines(settings: Settings, profile: EngineProfile = currentProfile()): { clean: TextModelChoice; planning: TextModelChoice; script: TextModelChoice } {
  if (profile === 'api') { const api: TextModelChoice = { provider: 'anthropic', model: settings.apiTextModel, effort: settings.apiEffort }; return { clean: api, planning: api, script: api }; }
  return { clean: { provider: settings.cleanProvider, model: settings.cleanModel, effort: settings.cleanEffort }, planning: { provider: settings.planningProvider, model: settings.planningModel, effort: settings.planningEffort }, script: { provider: settings.scriptProvider, model: settings.scriptModel, effort: settings.scriptEffort } };
}
function picturesEngine(settings: Awaited<ReturnType<typeof resolvedSettings>>) {
  return { provider: settings.picturesProvider, model: settings.picturesModel || undefined, effort: settings.picturesEffort || undefined, claudeBin: settings.claudeBin, codexBin: settings.codexBin };
}
async function hydrateProjects(clear = false) {
  const settings = await resolvedSettings();
  const loaded = await scanProjects(settings.projectsDir);
  if (clear) { projects.clear(); brollPlans.clear(); motionPlans.clear(); }
  for (const project of loaded) projects.set(project.id, project);
  return loaded;
}

async function canRun(binary: string, args: string[]) { if (!binary) return false; try { await run(binary, args, undefined, 5000); return true; } catch { return false; } }
async function claudeSignedIn(binary: string) {
  try { const { stdout } = await run(binary, ['auth', 'status', '--json'], undefined, 5000); return JSON.parse(stdout).loggedIn === true; }
  catch { return false; }
}
async function hasGflowSession(binary: string, profile?: string) {
  if (!binary) return false;
  try {
    const { stdout } = await run(binary, ['auth', 'list', '--json'], undefined, 5000);
    const profiles = JSON.parse(stdout) as Array<{ name?: string; is_default?: boolean; cookies_present?: boolean }>;
    if (!Array.isArray(profiles)) return false;
    const selected = profile ? profiles.find((candidate) => candidate.name === profile) : profiles.find((candidate) => candidate.is_default) ?? profiles[0];
    return Boolean(selected?.cookies_present);
  } catch { return false; }
}
async function ffmpegCapabilities(ffmpegBin: string): Promise<FfmpegCapabilities> {
  if (!ffmpegBin) return { videoToolboxDecode: false, h264VideoToolbox: false, hevcVideoToolbox: false };
  const cached = capabilityCache.get(ffmpegBin); if (cached) return cached;
  try {
    const [encoders, hwaccels] = await Promise.all([run(ffmpegBin, ['-hide_banner', '-encoders'], undefined, 10000), run(ffmpegBin, ['-hide_banner', '-hwaccels'], undefined, 10000)]);
    const result = { videoToolboxDecode: process.platform === 'darwin' && hwaccels.stdout.includes('videotoolbox'), h264VideoToolbox: process.platform === 'darwin' && encoders.stdout.includes('h264_videotoolbox'), hevcVideoToolbox: process.platform === 'darwin' && encoders.stdout.includes('hevc_videotoolbox') };
    capabilityCache.set(ffmpegBin, result); return result;
  } catch { return { videoToolboxDecode: false, h264VideoToolbox: false, hevcVideoToolbox: false }; }
}

async function systemStatus() {
  const settings = await resolvedSettings();
  const [codexInstalled, claudeInstalled, grokInstalled, gflowInstalled, ffmpegInstalled, ffprobeInstalled] = await Promise.all([canRun(settings.codexBin, ['--version']), canRun(settings.claudeBin, ['--version']), canRun(settings.grokBin, ['version']), canRun(settings.gflowBin, ['--version']), canRun(settings.ffmpegBin, ['-version']), canRun(settings.ffprobeBin, ['-version'])]);
  const [codexAuthenticated, claudeAuthenticated, gflowAuthenticated, capabilities, matting] = await Promise.all([
    codexInstalled ? canRun(settings.codexBin, ['login', 'status']) : Promise.resolve(false),
    claudeInstalled ? claudeSignedIn(settings.claudeBin) : Promise.resolve(false),
    gflowInstalled ? hasGflowSession(settings.gflowBin, settings.gflowProfile) : Promise.resolve(false),
    ffmpegInstalled ? ffmpegCapabilities(settings.ffmpegBin) : Promise.resolve({ videoToolboxDecode: false, h264VideoToolbox: false, hevcVideoToolbox: false }),
    mattingSystemStatus(ffmpegInstalled ? settings.ffmpegBin : ''),
  ]);
  return {
    codex: { installed: codexInstalled, authenticated: codexAuthenticated, path: settings.codexBin || null },
    claude: { installed: claudeInstalled, authenticated: claudeAuthenticated, path: settings.claudeBin || null },
    agy: { installed: Boolean(settings.agyBin) && await canRun(settings.agyBin, ['--version']), path: settings.agyBin || null },
    textModels: { clean: { provider: settings.cleanProvider, model: settings.cleanModel, effort: settings.cleanEffort }, planning: { provider: settings.planningProvider, model: settings.planningModel, effort: settings.planningEffort }, pictures: { provider: settings.picturesProvider, model: settings.picturesModel, effort: settings.picturesEffort }, script: { provider: settings.scriptProvider, model: settings.scriptModel, effort: settings.scriptEffort }, codexModel: settings.codexModel },
    grok: { installed: grokInstalled, path: settings.grokBin || null, model: settings.grokModel || 'CLI default', videoModel: settings.grokVideoModel },
    gflow: { installed: gflowInstalled, authenticated: gflowAuthenticated, path: settings.gflowBin || null, model: settings.gflowVideoModel, profile: settings.gflowProfile || 'default' },
    ffmpeg: { installed: ffmpegInstalled, path: settings.ffmpegBin || null, capabilities }, ffprobe: { installed: ffprobeInstalled, path: settings.ffprobeBin || null },
    elevenLabs: { configured: Boolean(settings.elevenLabsApiKey) }, imageProvider: settings.imageProvider,
    apiEngines: { anthropic: { configured: Boolean(settings.anthropicApiKey), model: settings.apiTextModel, effort: settings.apiEffort }, gemini: { configured: Boolean(settings.geminiApiKey), imageModel: settings.geminiImageModel }, allowedProfiles: allowedProfiles() },
    transcription: { provider: settings.sttProvider, model: settings.sttProvider === 'gemini' ? settings.geminiSttModel : 'scribe_v2', configured: Boolean(settings.sttProvider === 'gemini' ? settings.geminiApiKey : settings.elevenLabsApiKey) },
    imageProviders: {
      openai: { configured: Boolean(settings.openAiApiKey), model: settings.openAiImageModel }, gemini: { configured: Boolean(settings.geminiApiKey), model: settings.geminiImageModel },
      grokCli: { configured: grokInstalled, model: settings.grokModel || 'CLI default', experimental: true }, codexCli: { configured: codexInstalled && codexAuthenticated, model: 'Codex CLI', experimental: true },
    },
    videoProviders: {
      grokCli: { configured: grokInstalled, model: settings.grokVideoModel, experimental: true },
      googleFlow: { configured: gflowInstalled && gflowAuthenticated, model: settings.gflowVideoModel, profile: settings.gflowProfile || 'default', experimental: true },
      magnific: { configured: Boolean(settings.magnificApiKey), model: settings.magnificVideoModel, endpoint: settings.magnificVideoEndpoint, experimental: false },
    },
    brollVideo: { configured: grokInstalled || (gflowInstalled && gflowAuthenticated) || Boolean(settings.magnificApiKey), provider: 'Grok CLI / Google Flow / Magnific', model: `${settings.grokVideoModel} / ${settings.gflowVideoModel} / ${settings.magnificVideoModel}`, experimental: true },
    matting,
    motionGraphics: { browserPath: await detectChromeBin() || null, renderer: 'Remotion' },
    projectsDir: settings.projectsDir,
  };
}

async function pickNativeFile(prompt = 'Choose a talking-head video') {
  if (process.platform === 'darwin') { const { stdout } = await run('osascript', ['-e', `POSIX path of (choose file with prompt ${JSON.stringify(prompt)})`]); return stdout.trim(); }
  if (process.platform === 'win32') { const script = ['Add-Type -AssemblyName System.Windows.Forms;', '$d = New-Object System.Windows.Forms.OpenFileDialog;', '$d.Filter = "Video files|*.mov;*.mp4;*.m4v;*.webm|All files|*.*";', 'if ($d.ShowDialog() -eq "OK") { Write-Output $d.FileName }'].join(' '); const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]); return stdout.trim(); }
  const { stdout } = await run('zenity', ['--file-selection', `--title=${prompt}`, '--file-filter=Video | *.mov *.mp4 *.m4v *.webm']); return stdout.trim();
}

async function pickNativeFiles(prompt = 'Choose one or more talking-head clips') {
  if (process.platform === 'darwin') {
    const script = `set chosenFiles to choose file with prompt ${JSON.stringify(prompt)} with multiple selections allowed\nset output to ""\nrepeat with chosenFile in chosenFiles\nset output to output & POSIX path of chosenFile & linefeed\nend repeat\nreturn output`;
    const { stdout } = await run('osascript', ['-e', script]); return stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  }
  if (process.platform === 'win32') {
    const script = ['Add-Type -AssemblyName System.Windows.Forms;', '$d = New-Object System.Windows.Forms.OpenFileDialog;', '$d.Filter = "Video files|*.mov;*.mp4;*.m4v;*.webm|All files|*.*";', '$d.Multiselect = $true;', 'if ($d.ShowDialog() -eq "OK") { $d.FileNames | ForEach-Object { Write-Output $_ } }'].join(' ');
    const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]); return stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  }
  const { stdout } = await run('zenity', ['--file-selection', '--multiple', '--separator=\n', `--title=${prompt}`, '--file-filter=Video | *.mov *.mp4 *.m4v *.webm']); return stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

async function pickNativeImageFile() {
  if (process.platform === 'darwin') { const { stdout } = await run('osascript', ['-e', 'POSIX path of (choose file with prompt "Choose a B-roll image")']); return stdout.trim(); }
  if (process.platform === 'win32') { const script = ['Add-Type -AssemblyName System.Windows.Forms;', '$d = New-Object System.Windows.Forms.OpenFileDialog;', '$d.Filter = "Image files|*.png;*.jpg;*.jpeg;*.webp;*.heic;*.heif|All files|*.*";', 'if ($d.ShowDialog() -eq "OK") { Write-Output $d.FileName }'].join(' '); const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]); return stdout.trim(); }
  const { stdout } = await run('zenity', ['--file-selection', '--title=Choose a B-roll image', '--file-filter=Images | *.png *.jpg *.jpeg *.webp *.heic *.heif']); return stdout.trim();
}

async function pickNativeImageFiles(prompt = 'Choose thumbnail style / brand references') {
  if (process.platform === 'darwin') {
    const script = `set chosenFiles to choose file with prompt ${JSON.stringify(prompt)} with multiple selections allowed
set output to ""
repeat with chosenFile in chosenFiles
set output to output & POSIX path of chosenFile & linefeed
end repeat
return output`;
    const { stdout } = await run('osascript', ['-e', script]);
    return stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  }
  if (process.platform === 'win32') {
    const script = ['Add-Type -AssemblyName System.Windows.Forms;', '$d = New-Object System.Windows.Forms.OpenFileDialog;', '$d.Filter = "Image files|*.png;*.jpg;*.jpeg;*.webp;*.heic;*.heif|All files|*.*";', '$d.Multiselect = $true;', 'if ($d.ShowDialog() -eq "OK") { $d.FileNames | ForEach-Object { Write-Output $_ } }'].join(' ');
    const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]);
    return stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  }
  const { stdout } = await run('zenity', ['--file-selection', '--multiple', '--separator=\n', `--title=${prompt}`, '--file-filter=Images | *.png *.jpg *.jpeg *.webp *.heic *.heif']);
  return stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

async function pickExportPath(defaultName = 'cleaned-video.mp4', prompt = 'Export video') {
  if (process.platform === 'darwin') { const script = `POSIX path of (choose file name with prompt ${JSON.stringify(prompt)} default name ${JSON.stringify(defaultName)})`; const { stdout } = await run('osascript', ['-e', script]); return stdout.trim(); }
  if (process.platform === 'win32') { const script = ['Add-Type -AssemblyName System.Windows.Forms;', '$d = New-Object System.Windows.Forms.SaveFileDialog;', '$d.Filter = "MP4 video|*.mp4";', `$d.FileName = ${JSON.stringify(defaultName)};`, 'if ($d.ShowDialog() -eq "OK") { Write-Output $d.FileName }'].join(' '); const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]); return stdout.trim(); }
  const { stdout } = await run('zenity', ['--file-selection', '--save', '--confirm-overwrite', `--filename=${defaultName}`]); return stdout.trim();
}
async function pickFolderPath() {
  if (process.platform === 'darwin') { const { stdout } = await run('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose folder for B-roll assets")']); return stdout.trim(); }
  if (process.platform === 'win32') { const script = ['Add-Type -AssemblyName System.Windows.Forms;', '$d = New-Object System.Windows.Forms.FolderBrowserDialog;', 'if ($d.ShowDialog() -eq "OK") { Write-Output $d.SelectedPath }'].join(' '); const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]); return stdout.trim(); }
  const { stdout } = await run('zenity', ['--file-selection', '--directory', '--title=Choose folder for B-roll assets']); return stdout.trim();
}
async function pickZipPath(defaultName = 'video-cleaner-project.zip') {
  if (process.platform === 'darwin') { const script = `POSIX path of (choose file name with prompt "Export editable project ZIP" default name ${JSON.stringify(defaultName)})`; const { stdout } = await run('osascript', ['-e', script]); return stdout.trim(); }
  if (process.platform === 'win32') { const script = ['Add-Type -AssemblyName System.Windows.Forms;', '$d = New-Object System.Windows.Forms.SaveFileDialog;', '$d.Filter = "ZIP archive|*.zip";', `$d.FileName = ${JSON.stringify(defaultName)};`, 'if ($d.ShowDialog() -eq "OK") { Write-Output $d.FileName }'].join(' '); const { stdout } = await run('powershell', ['-NoProfile', '-Command', script]); return stdout.trim(); }
  const { stdout } = await run('zenity', ['--file-selection', '--save', '--confirm-overwrite', `--filename=${defaultName}`]); return stdout.trim();
}

function parseRate(value: unknown) { if (typeof value !== 'string' || !value) return 0; if (!value.includes('/')) return Number(value) || 0; const [n, d] = value.split('/').map(Number); return d ? n / d : 0; }
async function probe(sourcePath: string): Promise<MediaProfile> {
  const settings = await resolvedSettings(); if (!settings.ffprobeBin) throw new Error('ffprobe was not found.');
  const { stdout } = await run(settings.ffprobeBin, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', sourcePath]); const data = JSON.parse(stdout);
  const video = data.streams?.find((stream: any) => stream.codec_type === 'video') ?? {}; const audio = data.streams?.find((stream: any) => stream.codec_type === 'audio') ?? {};
  const rotation = Number(video.side_data_list?.find((item: any) => item.side_data_type === 'Display Matrix')?.rotation ?? video.tags?.rotate ?? 0); const swap = Math.abs(rotation) % 180 === 90;
  const width = Number(video.width) || undefined; const height = Number(video.height) || undefined; const transfer = String(video.color_transfer ?? '').toLowerCase(); const primaries = String(video.color_primaries ?? '').toLowerCase();
  return { duration: Number(data.format?.duration ?? video.duration ?? 0), size: Number(data.format?.size ?? 0), width: swap ? height : width, height: swap ? width : height, frameRate: parseRate(video.avg_frame_rate || video.r_frame_rate), bitRate: Number(video.bit_rate ?? 0) || undefined, videoCodec: video.codec_name, audioCodec: audio.codec_name, pixelFormat: video.pix_fmt, colorTransfer: video.color_transfer, colorPrimaries: video.color_primaries, colorSpace: video.color_space, colorRange: video.color_range, rotation, hdr: ['smpte2084', 'arib-std-b67'].includes(transfer) || primaries === 'bt2020' };
}
configureVideoDurationProbe(async (file) => (await probe(file)).duration);
/** Browser recordings (Chrome's WebM) carry no length; a lossless remux writes it so every later step knows the duration. */
async function withDuration(sourcePath: string, media: MediaProfile) {
  if (media.duration > 0) return { sourcePath, media };
  const settings = await resolvedSettings(); const fixed = sourcePath.replace(/(\.[a-z0-9]+)?$/i, '.timed.mkv');
  await run(settings.ffmpegBin, ['-v', 'error', '-y', '-i', sourcePath, '-c', 'copy', fixed]);
  return { sourcePath: fixed, media: await probe(fixed) };
}

function rotationFilter(rotation?: number) {
  const degrees = ((Math.round(rotation || 0) % 360) + 360) % 360;
  // Display-matrix rotation uses the opposite sign from the transpose filter.
  // For example, an iPhone rotation of -90 (normalized to 270) matches clock.
  if (degrees === 90) return 'transpose=cclock';
  if (degrees === 270) return 'transpose=clock';
  if (degrees === 180) return 'hflip,vflip';
  return '';
}

function assertCompatibleClips(items: Array<{ sourcePath: string; media: MediaProfile }>) {
  const first = items[0]; if (!first) throw new Error('Choose at least one clip');
  if (!first.media.audioCodec) throw new Error(`${path.basename(first.sourcePath)} has no audio track. Multi-clip talking-head projects currently require audio in every clip.`);
  for (const item of items.slice(1)) {
    const a = first.media; const b = item.media; const name = path.basename(item.sourcePath);
    if (!b.audioCodec) throw new Error(`${name} has no audio track. Multi-clip talking-head projects currently require audio in every clip.`);
    if (a.width !== b.width || a.height !== b.height) throw new Error(`${name} is ${b.width || '?'}×${b.height || '?'}. Multi-clip projects currently require the same frame dimensions as the first clip (${a.width || '?'}×${a.height || '?'}).`);
    if (Math.abs((a.frameRate || 30) - (b.frameRate || 30)) > 0.75) throw new Error(`${name} uses ${(b.frameRate || 0).toFixed(2)} fps. Multi-clip projects currently require matching frame rates.`);
    if (Boolean(a.hdr) !== Boolean(b.hdr)) throw new Error(`${name} does not match the first clip's HDR/SDR format. Keep all clips HDR or all clips SDR in one project.`);
  }
}

function routeParam(value: string | string[]) { return Array.isArray(value) ? value[0] : value; }
function getProject(id: string) { const project = projects.get(id); if (!project) throw new Error('Project not found in the local project library.'); return project; }
async function sourceAvailable(project: Project) { const results = await Promise.all(projectClips(project).map((clip) => fs.stat(clip.sourcePath).then((stat) => stat.isFile()).catch(() => false))); return results.every(Boolean); }
async function requireSource(project: Project) { if (await sourceAvailable(project)) return; const missing: string[] = []; for (const clip of projectClips(project)) if (!await fs.stat(clip.sourcePath).then((stat) => stat.isFile()).catch(() => false)) missing.push(clip.sourceName); throw new Error(`Original source clip${missing.length === 1 ? '' : 's'} missing: ${missing.join(', ')}. Relink before this operation.`); }
async function touchProject(project: Project) { await saveProject(project); }
async function invalidateMotion(project: Project) { motionPlans.delete(project.id); await Promise.all([fs.rm(path.join(project.workDir, 'motion-plan.json'), { force: true }), fs.rm(path.join(project.workDir, 'motion'), { recursive: true, force: true })]); }
async function invalidateBroll(project: Project) { brollPlans.delete(project.id); await Promise.all([fs.rm(path.join(project.workDir, 'broll-plan.json'), { force: true }), invalidateMotion(project)]); await touchProject(project); }
async function invalidateSourceDerivedState(project: Project) {
  brollPlans.delete(project.id); await invalidateMotion(project); project.proxyPath = undefined; project.audioPath = undefined; project.transcript = undefined; project.edl = undefined;
  await Promise.all([
    fs.rm(path.join(project.workDir, 'proxy.mp4'), { force: true }),
    fs.rm(path.join(project.workDir, 'analysis.m4a'), { force: true }),
    fs.rm(path.join(project.workDir, 'transcript.json'), { force: true }),
    fs.rm(path.join(project.workDir, 'edl.json'), { force: true }),
    fs.rm(path.join(project.workDir, 'broll-plan.json'), { force: true }),
  ]);
  await touchProject(project);
}

function validateEdl(words: Word[], raw: any) {
  const index = new Map(words.map((word, i) => [word.id, i])); let previousEnd = -1; const ranges: KeepRange[] = [];
  for (const range of raw.keepRanges ?? []) { const start = index.get(range.startWordId); const end = index.get(range.endWordId); if (start === undefined || end === undefined || start > end) throw new Error('Invalid EDL word range'); if (start <= previousEnd) throw new Error('EDL ranges overlap or are out of order'); previousEnd = end; ranges.push({ startWordId: range.startWordId, endWordId: range.endWordId, reason: range.reason ?? '' }); }
  if (!ranges.length) throw new Error('The edit removed the entire video'); return { keepRanges: ranges, notes: Array.isArray(raw.notes) ? raw.notes : [] };
}
function rangesToSeconds(project: Project) {
  const words = project.transcript!.words; const index = new Map(words.map((word, i) => [word.id, i]));
  return project.edl!.keepRanges.map((range) => {
    const startIndex = index.get(range.startWordId)!; const endIndex = index.get(range.endWordId)!; const startWord = words[startIndex]; const endWord = words[endIndex];
    const previousRemovedWord = startIndex > 0 ? words[startIndex - 1] : undefined; const nextRemovedWord = endIndex < words.length - 1 ? words[endIndex + 1] : undefined;
    const paddedStart = Math.max(0, startWord.start - 0.08); const paddedEnd = Math.min(project.media.duration || Number.POSITIVE_INFINITY, endWord.end + 0.12);
    const start = previousRemovedWord ? Math.max(paddedStart, Math.min(startWord.start, previousRemovedWord.end + 0.01)) : paddedStart;
    const end = nextRemovedWord ? Math.min(paddedEnd, Math.max(endWord.end, nextRemovedWord.start - 0.01)) : paddedEnd;
    return { start, end };
  }).filter((range) => range.end > range.start);
}
function proxySize(media: MediaProfile, maxEdge = 720) { const width = media.width || 1280; const height = media.height || 720; const even = (v: number) => Math.max(2, Math.round(v / 2) * 2); if (width >= height) { const w = Math.min(maxEdge, width); return { width: even(w), height: even(height * w / width) }; } const h = Math.min(maxEdge, height); return { width: even(width * h / height), height: even(h) }; }
function sdrBt709VideoFilter(media: MediaProfile, leadingFilters: string[] = []) { return [...leadingFilters, colorVideoFilter(media)].join(','); }
function bt709ColorArgs() { return ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709']; }
function splitSegmentsAtClipBoundaries(project: Project, segments: Array<{ start: number; end: number }>) { return segments.flatMap((segment) => splitTimelineRange(project, segment.start, segment.end).map((piece) => ({ start: piece.start, end: piece.end }))); }

function concatEntry(filePath: string) { return `file '${filePath.replaceAll("'", "'\\''")}'`; }
async function concatPreparedFiles(ffmpegBin: string, inputs: string[], outputPath: string) {
  if (inputs.length === 1) return inputs[0];
  const listPath = `${outputPath}.concat.txt`; await fs.writeFile(listPath, `${inputs.map(concatEntry).join('\n')}\n`); await fs.rm(outputPath, { force: true });
  try { await run(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', outputPath], undefined, 600_000); }
  finally { await fs.rm(listPath, { force: true }); }
  return outputPath;
}

const PROXY_COLOR_PIPELINE_VERSION = 2;

async function prepareProjectMedia(project: Project, includeProxy: boolean) {
  await requireSource(project); const settings = await resolvedSettings(); if (!settings.ffmpegBin) throw new Error('FFmpeg was not found.'); const capabilities = await ffmpegCapabilities(settings.ffmpegBin); const clips = syncProjectTimeline(project); const dimensions = proxySize(project.media); const inputAcceleration = capabilities.videoToolboxDecode ? ['-hwaccel', 'videotoolbox'] : []; const proxyEncoder = capabilities.h264VideoToolbox ? ['-c:v', 'h264_videotoolbox', '-realtime', '1', '-prio_speed', '1', '-allow_sw', '1', '-b:v', '1500k', '-maxrate', '2500k', '-bufsize', '4M'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28'];
  for (const clip of clips) {
    const clipDir = path.join(project.workDir, 'clips', clip.id); await fs.mkdir(clipDir, { recursive: true }); const audioPath = path.join(clipDir, 'analysis.m4a'); const proxyPath = path.join(clipDir, 'proxy.mp4'); const proxyMetaPath = path.join(clipDir, 'proxy.meta.json');
    const audioReady = await fs.stat(audioPath).then((stat) => stat.isFile() && stat.size > 1000).catch(() => false); let proxyReady = await fs.stat(proxyPath).then((stat) => stat.isFile() && stat.size > 10_000).catch(() => false);
    if (proxyReady && clip.media.hdr) {
      const [existingProxy, proxyMeta] = await Promise.all([probe(proxyPath).catch(() => null), fs.readFile(proxyMetaPath, 'utf8').then((value) => JSON.parse(value)).catch(() => null)]);
      proxyReady = proxyMeta?.colorPipeline === PROXY_COLOR_PIPELINE_VERSION && existingProxy?.colorPrimaries === 'bt709' && existingProxy?.colorTransfer === 'bt709' && existingProxy?.colorSpace === 'bt709';
    }
    if (includeProxy && (!audioReady || !proxyReady)) {
      const rotation = rotationFilter(clip.media.rotation); const proxyFilter = [rotation, colorVideoFilter(clip.media), `scale=${dimensions.width}:${dimensions.height}:flags=fast_bilinear`, 'fps=30', 'format=yuv420p'].filter(Boolean).join(',');
      await run(settings.ffmpegBin, ['-hide_banner', '-y', '-noautorotate', '-display_rotation:v', '0', ...inputAcceleration, '-i', clip.sourcePath, '-map', '0:v:0', '-map', '0:a:0', '-vf', proxyFilter, ...proxyEncoder, ...bt709ColorArgs(), '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', proxyPath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', audioPath], undefined, 7_200_000);
      await atomicWriteJson(proxyMetaPath, { colorPipeline: PROXY_COLOR_PIPELINE_VERSION, generatedAt: new Date().toISOString() });
    } else if (!audioReady) {
      await run(settings.ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', clip.sourcePath, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', audioPath], undefined, 1_800_000);
    }
    clip.audioPath = audioPath; if (includeProxy) clip.proxyPath = proxyPath;
  }
  const combinedAudio = await concatPreparedFiles(settings.ffmpegBin, clips.map((clip) => clip.audioPath!), path.join(project.workDir, 'analysis.m4a')); project.audioPath = combinedAudio;
  if (includeProxy) { const combinedProxy = await concatPreparedFiles(settings.ffmpegBin, clips.map((clip) => clip.proxyPath!), path.join(project.workDir, 'proxy.mp4')); project.proxyPath = combinedProxy; }
  await touchProject(project); return { dimensions, hardware: capabilities.h264VideoToolbox };
}

async function renderBrollScenePreview(project: Project, plan: BrollPlan, sceneId: string, ffmpegBin: string) {
  const scene = plan.scenes.find((candidate) => candidate.id === sceneId); if (!scene) throw new Error('B-roll scene not found');
  const assetPath = scene.videoFile || scene.imageFile; if (!assetPath) throw new Error('Add or generate a B-roll image or video before previewing');
  let sourcePath = project.proxyPath && await fs.stat(project.proxyPath).then((stat) => stat.isFile()).catch(() => false) ? project.proxyPath : '';
  let sourceStart = scene.sourceStart;
  if (!sourcePath) { const clip = clipAtTimelineTime(project, scene.sourceStart); if (!clip) throw new Error('No source clip covers this B-roll scene'); if (scene.sourceEnd > clip.timelineEnd + 0.001) throw new Error('This B-roll scene crosses a clip boundary. Create the combined proxy before previewing it.'); sourcePath = clip.sourcePath; sourceStart = scene.sourceStart - clip.timelineStart; }
  const [sourceStat, assetStat] = await Promise.all([fs.stat(sourcePath), fs.stat(assetPath)]); const dimensions = proxySize(project.media, 720); const fps = Math.min(30, Math.max(15, project.media.frameRate || 30)); const duration = Math.max(0.5, Math.min(12, scene.sourceEnd - scene.sourceStart)); const template = scene.displayTemplate || plan.settings.displayTemplate || 'full-frame';
  const cacheKey = createHash('sha256').update(JSON.stringify({ previewPipeline: 6, sourcePath, sourceSize: sourceStat.size, sourceMtime: sourceStat.mtimeMs, start: sourceStart, assetPath, assetSize: assetStat.size, assetMtime: assetStat.mtimeMs, duration, template, width: dimensions.width, height: dimensions.height, fps })).digest('hex').slice(0, 16);
  const previewDir = path.join(project.workDir, 'previews', scene.id); const previewPath = path.join(previewDir, 'preview.mp4'); const segmentPath = path.join(previewDir, 'source-segment.mp4'); const metaPath = path.join(previewDir, 'preview.json'); await fs.mkdir(previewDir, { recursive: true });
  const [previewStat, cachedMeta] = await Promise.all([fs.stat(previewPath).catch(() => null), fs.readFile(metaPath, 'utf8').then((value) => JSON.parse(value)).catch(() => null)]);
  if (previewStat?.isFile() && previewStat.size > 10_000 && cachedMeta?.cacheKey === cacheKey) return { previewPath, cacheKey, duration, cached: true };

  const sourceMedia = await probe(sourcePath); const previewSourceFilter = sdrBt709VideoFilter(sourceMedia, [rotationFilter(sourceMedia.rotation), `scale=${dimensions.width}:${dimensions.height}:flags=fast_bilinear`, `fps=${fps.toFixed(6)}`].filter(Boolean));
  await run(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', sourceStart.toFixed(6), '-t', duration.toFixed(6), '-noautorotate', '-display_rotation:v', '0', '-i', sourcePath, '-map', '0:v:0', '-map', '0:a:0?', '-vf', previewSourceFilter, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27', ...bt709ColorArgs(), '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', segmentPath], undefined, 300_000);
  const previewScene = { ...scene, sourceStart: 0, sourceEnd: duration, enabled: true }; const previewPlan: BrollPlan = { ...plan, orientation: dimensions.height >= dimensions.width ? 'portrait' : 'landscape', settings: { ...plan.settings, workflowMode: 'raw-video' }, scenes: [previewScene] };
  let mattePath: string | undefined;
  if (planNeedsPresenterMatte(previewPlan)) {
    const matte = await ensurePresenterMatte({ workDir: previewDir, sourcePath: segmentPath, proxyPath: segmentPath, width: dimensions.width, height: dimensions.height, ffmpegBin }); mattePath = matte.maskPath;
    if (!mattePath) throw new Error('Presenter cutout preview could not prepare its alpha mask');
  }
  const { filter, activeScenes } = buildBrollOverlayFilter({ plan: previewPlan, width: dimensions.width, height: dimensions.height, fps, presenterInputIndex: mattePath ? 2 : undefined, assetColors: { [scene.id]: await probe(assetPath) } });
  const brollInputs = activeScenes[0].videoFile ? ['-stream_loop', '-1', '-i', activeScenes[0].videoFile] : ['-loop', '1', '-framerate', String(fps), '-i', activeScenes[0].imageFile!]; const presenterInput = mattePath ? ['-i', mattePath] : [];
  await run(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', segmentPath, ...brollInputs, ...presenterInput, '-filter_complex', filter, '-map', '[vout]', '-map', '[aout]', '-t', duration.toFixed(6), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', ...bt709ColorArgs(), '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', previewPath], undefined, 600_000);
  const resultStat = await fs.stat(previewPath).catch(() => null); if (!resultStat?.isFile() || resultStat.size < 10_000) throw new Error('Scene preview finished without creating a playable video');
  await atomicWriteJson(metaPath, { cacheKey, generatedAt: new Date().toISOString(), duration, template }); return { previewPath, cacheKey, duration, cached: false };
}

async function renderBrollProjectPreview(project: Project, plan: BrollPlan, ffmpegBin: string) {
  const proxyCandidate = project.proxyPath ? (path.isAbsolute(project.proxyPath) ? project.proxyPath : path.resolve(project.workDir, project.proxyPath)) : '';
  const proxyStat = await fs.stat(proxyCandidate).catch(() => null);
  if (!proxyCandidate || !proxyStat?.isFile() || proxyStat.size < 10_000) throw new Error('Create or restore the proxy video before previewing the complete B-roll video.');

  const resolvedScenes = await Promise.all(plan.scenes.map(async (scene) => {
    const [imageFile, videoFile] = await Promise.all([
      resolveBrollAssetPath(project.workDir, scene, 'image'),
      resolveBrollAssetPath(project.workDir, scene, 'video'),
    ]);
    return { ...scene, imageFile, videoFile };
  }));
  const activeScenes = resolvedScenes.filter((scene) => scene.enabled && (scene.videoFile || scene.imageFile));
  if (!activeScenes.length) throw new Error('Add at least one enabled B-roll image or video before previewing');

  const proxyMedia = await probe(proxyCandidate);
  const dimensions = proxySize(proxyMedia, 720);
  const fps = Math.min(30, Math.max(15, proxyMedia.frameRate || project.media.frameRate || 30));
  const cleanedSegments = plan.settings.workflowMode === 'cleaned-video' && project.transcript?.words.length && project.edl?.keepRanges.length ? rangesToSeconds(project) : undefined;
  const previewDuration = cleanedSegments?.length
    ? cleanedSegments.reduce((total, segment) => total + Math.max(0, segment.end - segment.start), 0)
    : proxyMedia.duration;
  if (!Number.isFinite(previewDuration) || previewDuration <= 0) throw new Error('The proxy video has no usable duration for previewing.');

  const assetStats = await Promise.all(activeScenes.map(async (scene) => {
    const assetPath = scene.videoFile || scene.imageFile!;
    const stat = await fs.stat(assetPath);
    return { id: scene.id, path: assetPath, size: stat.size, mtime: stat.mtimeMs };
  }));
  const cacheKey = createHash('sha256').update(JSON.stringify({
    previewPipeline: 1,
    proxyPath: proxyCandidate,
    proxySize: proxyStat.size,
    proxyMtime: proxyStat.mtimeMs,
    duration: proxyMedia.duration,
    width: dimensions.width,
    height: dimensions.height,
    fps,
    cleanedSegments,
    workflowMode: plan.settings.workflowMode,
    displayTemplate: plan.settings.displayTemplate,
    scenes: activeScenes.map((scene) => ({
      id: scene.id,
      sourceStart: scene.sourceStart,
      sourceEnd: scene.sourceEnd,
      displayTemplate: scene.displayTemplate,
      imageFile: scene.imageFile,
      videoFile: scene.videoFile,
      generatedAt: scene.generatedAt,
      videoGeneratedAt: scene.videoGeneratedAt,
    })),
    assetStats,
  })).digest('hex').slice(0, 16);
  const previewDir = path.join(project.workDir, 'previews', 'project');
  const previewPath = path.join(previewDir, 'preview.mp4');
  const metaPath = path.join(previewDir, 'preview.json');
  await fs.mkdir(previewDir, { recursive: true });
  const [previewOutputStat, cachedMeta] = await Promise.all([
    fs.stat(previewPath).catch(() => null),
    fs.readFile(metaPath, 'utf8').then((value) => JSON.parse(value)).catch(() => null),
  ]);
  if (previewOutputStat?.isFile() && previewOutputStat.size > 10_000 && cachedMeta?.cacheKey === cacheKey) {
    return { previewPath, cacheKey, duration: Number(cachedMeta.duration) || previewDuration, cached: true, sceneCount: activeScenes.length };
  }

  const previewPlan: BrollPlan = {
    ...plan,
    settings: { ...plan.settings, workflowMode: 'raw-video' },
    scenes: resolvedScenes,
  };
  let mattePath: string | undefined;
  if (planNeedsPresenterMatte(previewPlan)) {
    const matte = await ensurePresenterMatte({ workDir: previewDir, sourcePath: proxyCandidate, proxyPath: proxyCandidate, width: dimensions.width, height: dimensions.height, ffmpegBin });
    mattePath = matte.maskPath;
    if (!mattePath) throw new Error('Presenter cutout preview could not prepare its alpha mask');
  }
  const assetColors: Record<string, MediaProfile> = {};
  for (const scene of activeScenes) assetColors[scene.id] = await probe((scene.videoFile || scene.imageFile)!);
  const includeAudio = Boolean(proxyMedia.audioCodec);
  const baseVideoFilter = sdrBt709VideoFilter(proxyMedia, [rotationFilter(proxyMedia.rotation), `scale=${dimensions.width}:${dimensions.height}:flags=fast_bilinear`, `fps=${fps.toFixed(6)}`].filter(Boolean));
  const { filter, activeScenes: filterScenes } = buildBrollOverlayFilter({
    plan: previewPlan,
    width: dimensions.width,
    height: dimensions.height,
    fps,
    cleanedSegments: cleanedSegments?.length ? cleanedSegments : undefined,
    presenterInputIndex: mattePath ? activeScenes.length + 1 : undefined,
    includeAudio,
    baseVideoFilter,
    assetColors,
  });
  const brollInputs = filterScenes.flatMap((scene) => scene.videoFile
    ? ['-stream_loop', '-1', '-i', scene.videoFile]
    : ['-loop', '1', '-framerate', String(fps), '-i', scene.imageFile!]);
  const presenterInput = mattePath ? ['-i', mattePath] : [];
  const audioOutput = includeAudio ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '96k'] : ['-an'];
  await run(ffmpegBin, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-noautorotate', '-display_rotation:v', '0', '-i', proxyCandidate,
    ...brollInputs, ...presenterInput,
    '-filter_complex', filter,
    '-map', '[vout]', ...audioOutput,
    '-t', previewDuration.toFixed(6),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
    ...bt709ColorArgs(), '-movflags', '+faststart', previewPath,
  ], undefined, 900_000);
  const resultStat = await fs.stat(previewPath).catch(() => null);
  if (!resultStat?.isFile() || resultStat.size < 10_000) throw new Error('Complete B-roll preview finished without creating a playable video');
  await atomicWriteJson(metaPath, { cacheKey, generatedAt: new Date().toISOString(), duration: previewDuration, sceneCount: activeScenes.length });
  return { previewPath, cacheKey, duration: previewDuration, cached: false, sceneCount: activeScenes.length };
}

async function ensureAnalysisAudio(project: Project) {
  if (project.audioPath) { const exists = await fs.stat(project.audioPath).catch(() => null); if (exists?.isFile()) return project.audioPath; }
  await prepareProjectMedia(project, false); if (!project.audioPath) throw new Error('Analysis audio was not created'); return project.audioPath;
}
async function transcribeProject(project: Project) {
  if (project.transcript?.words.length) return project.transcript;
  const settings = await resolvedSettings();
  if (!settings.ffmpegBin) throw new Error('FFmpeg was not found');
  const audioPath = await ensureAnalysisAudio(project);
  const result = await transcribeAudio(audioPath, {
    provider: settings.sttProvider, ffmpegBin: settings.ffmpegBin, workDir: project.workDir,
    geminiApiKey: settings.geminiApiKey, geminiModel: settings.geminiSttModel, elevenLabsApiKey: settings.elevenLabsApiKey,
  });
  const words = result.words;
  project.transcript = { text: result.text, words };
  project.edl = { keepRanges: [{ startWordId: words[0].id, endWordId: words.at(-1)!.id, reason: 'Original recording' }], notes: [] }; await invalidateBroll(project);
  await Promise.all([atomicWriteJson(path.join(project.workDir, 'transcript.json'), { ...project.transcript, language: result.language, provider: result.provider, model: result.model }), touchProject(project)]);
  return project.transcript;
}

function defaultBitRate(media: MediaProfile, hevc: boolean) { const pixels = (media.width || 1920) * (media.height || 1080); const highFps = (media.frameRate || 30) > 35; if (pixels >= 3840 * 2000) return hevc ? (highFps ? 70_000_000 : 45_000_000) : (highFps ? 95_000_000 : 65_000_000); if (pixels >= 1920 * 1000) return hevc ? (highFps ? 25_000_000 : 16_000_000) : (highFps ? 35_000_000 : 22_000_000); return hevc ? 10_000_000 : 14_000_000; }
function exportBitRate(media: MediaProfile, hevc: boolean, mode: 'fast' | 'quality') { const baseline = media.bitRate || defaultBitRate(media, hevc); const floor = defaultBitRate(media, hevc); const desired = mode === 'quality' ? Math.max(floor, baseline * 1.05) : Math.max(floor * 0.75, baseline * 0.78); return Math.min(140_000_000, Math.round(desired)); }
function formatBitRate(value: number) { return `${Math.max(1, Math.round(value / 1000))}k`; }
function sourceBitDepth(pixelFormat?: string) { const match = String(pixelFormat ?? '').toLowerCase().match(/(9|10|12|14|16)(?:le|be)?$/); return match ? Number(match[1]) : 8; }
function hevcOutputPixelFormat(media: MediaProfile) { return media.hdr || sourceBitDepth(media.pixelFormat) > 8 ? 'yuv420p10le' : 'yuv420p'; }
function encodingArgs(project: Project, capabilities: FfmpegCapabilities, mode: 'fast' | 'quality', forceSdr = false) {
  const sourceCodec = String(project.media.videoCodec || '').toLowerCase(); const useHevc = !forceSdr && (project.media.hdr || sourceCodec === 'hevc' || sourceCodec === 'h265'); const hardware = useHevc ? capabilities.hevcVideoToolbox : capabilities.h264VideoToolbox; const targetBitRate = exportBitRate(project.media, useHevc, mode); const pixelFormat = forceSdr ? 'yuv420p' : hevcOutputPixelFormat(project.media); const main10 = pixelFormat === 'yuv420p10le';
  if (hardware) { const encoder = useHevc ? 'hevc_videotoolbox' : 'h264_videotoolbox'; return { encoder, hardware, targetBitRate, args: ['-c:v', encoder, '-allow_sw', '1', ...(mode === 'fast' ? ['-realtime', '1', '-prio_speed', '1'] : []), '-b:v', formatBitRate(targetBitRate), '-maxrate', formatBitRate(Math.round(targetBitRate * 1.2)), '-bufsize', formatBitRate(Math.round(targetBitRate * 2)), ...(useHevc ? ['-pix_fmt', main10 ? 'p010le' : pixelFormat, '-tag:v', 'hvc1', ...(main10 ? ['-profile:v', 'main10'] : [])] : forceSdr ? ['-pix_fmt', 'yuv420p'] : [])] }; }
  if (useHevc) return { encoder: 'libx265', hardware: false, targetBitRate, args: ['-c:v', 'libx265', '-preset', mode === 'fast' ? 'veryfast' : 'fast', '-crf', mode === 'fast' ? '19' : '16', '-pix_fmt', pixelFormat, '-tag:v', 'hvc1'] };
  return { encoder: 'libx264', hardware: false, targetBitRate, args: ['-c:v', 'libx264', '-preset', mode === 'fast' ? 'superfast' : 'veryfast', '-crf', mode === 'fast' ? '19' : '17', ...(forceSdr ? ['-pix_fmt', 'yuv420p'] : [])] };
}
function colorArgs(project: Project) { const args: string[] = []; if (project.media.colorPrimaries) args.push('-color_primaries', project.media.colorPrimaries); if (project.media.colorTransfer) args.push('-color_trc', project.media.colorTransfer); if (project.media.colorSpace) args.push('-colorspace', project.media.colorSpace); return args; }
function parseFfmpegTime(value: string) { const parts = value.split(':').map(Number); if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return 0; return parts[0] * 3600 + parts[1] * 60 + parts[2]; }
type CheckpointRange = { start: number; end: number; duration: number };
function checkpointRanges(segments: Array<{ start: number; end: number }>, scenes: BrollPlan['scenes'], targetDuration = 12) {
  const ranges: CheckpointRange[] = [];
  for (const segment of segments) {
    let cursor = Math.max(0, segment.start); const segmentEnd = Math.max(cursor, segment.end);
    while (segmentEnd - cursor > 0.01) {
      let boundary = Math.min(segmentEnd, cursor + targetDuration);
      if (boundary < segmentEnd) {
        const crossing = scenes.filter((scene) => scene.enabled && (scene.videoFile || scene.imageFile) && scene.sourceStart < boundary && scene.sourceEnd > boundary);
        if (crossing.length) boundary = Math.min(segmentEnd, Math.max(...crossing.map((scene) => scene.sourceEnd)));
        if (segmentEnd - boundary < 2) boundary = segmentEnd;
      }
      if (boundary <= cursor + 0.01) boundary = segmentEnd;
      ranges.push({ start: cursor, end: boundary, duration: boundary - cursor }); cursor = boundary;
    }
  }
  return ranges;
}
async function checkpointSignature(filePath: string) { const stat = await fs.stat(filePath); return { path: filePath, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) }; }
async function checkpointFingerprint(options: { project: Project; plan?: BrollPlan; mattePaths?: string[]; mode: 'fast' | 'quality'; segments: Array<{ start: number; end: number }>; encodingArgs: string[]; fps: number }) {
  const activeScenes = options.plan?.scenes.filter((scene) => scene.enabled && (scene.videoFile || scene.imageFile)) ?? []; const files = [...projectClips(options.project).map((clip) => clip.sourcePath), ...(options.mattePaths ?? []), ...activeScenes.map((scene) => scene.videoFile || scene.imageFile)].filter((value): value is string => Boolean(value)); const signatures = await Promise.all(files.map(checkpointSignature));
  const payload = { pipeline: 7, signatures, mode: options.mode, segments: options.segments, encodingArgs: options.encodingArgs, fps: options.fps, width: options.project.media.width, height: options.project.media.height, color: [options.project.media.colorPrimaries, options.project.media.colorTransfer, options.project.media.colorSpace], scenes: activeScenes.map((scene) => ({ id: scene.id, start: scene.sourceStart, end: scene.sourceEnd, template: scene.displayTemplate || options.plan?.settings.displayTemplate, file: scene.videoFile || scene.imageFile })) };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
}
function runTrackedExportProcess(projectId: string, command: string, args: string[], onProgress?: (seconds: number, speed: string, frame: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', ...args], { shell: false, windowsHide: true }); exportProcesses.set(projectId, child); let stdoutBuffer = ''; let stderr = ''; let speed = ''; let frame = 0; let seconds = 0; let settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; if (exportProcesses.get(projectId) === child) exportProcesses.delete(projectId); error ? reject(error) : resolve(); };
    const handleLine = (line: string) => { const equals = line.indexOf('='); if (equals < 0) return; const key = line.slice(0, equals); const value = line.slice(equals + 1); if (key === 'out_time') seconds = parseFfmpegTime(value); else if (key === 'out_time_us' || key === 'out_time_ms') seconds = Number(value) / 1_000_000; else if (key === 'speed') speed = value; else if (key === 'frame') frame = Number(value) || frame; onProgress?.(seconds, speed, frame); };
    child.stdout.on('data', (chunk) => { stdoutBuffer += chunk.toString(); let newline = stdoutBuffer.indexOf('\n'); while (newline >= 0) { handleLine(stdoutBuffer.slice(0, newline).trim()); stdoutBuffer = stdoutBuffer.slice(newline + 1); newline = stdoutBuffer.indexOf('\n'); } }); child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-12000); }); child.on('error', (error) => finish(error)); child.on('close', (code, signal) => code === 0 ? finish() : finish(new Error(stderr || `FFmpeg exited with ${signal || `code ${code}`}`)));
  });
}
function launchCheckpointExport(options: { projectId: string; command: string; sessionDir: string; fingerprint: string; outputPath: string; encoder: string; ranges: CheckpointRange[]; buildPartArgs: (range: CheckpointRange, outputPath: string) => string[]; audioArgs: (outputPath: string) => string[] }) {
  const { projectId, command, sessionDir, fingerprint, outputPath, encoder, ranges } = options; const totalDuration = ranges.reduce((sum, range) => sum + range.duration, 0); const partPath = (index: number) => path.join(sessionDir, `part-${String(index).padStart(4, '0')}.mp4`); const manifestPath = path.join(sessionDir, 'manifest.json');
  const job: ExportJob = { state: 'running', progress: 0, outTime: '00:00:00.000000', speed: 'Checking saved checkpoints…', frame: 0, outputPath, encoder, checkpointCompleted: 0, checkpointTotal: ranges.length, resumable: true, resumed: false, startedAt: Date.now() }; exportJobs.set(projectId, job);
  void (async () => {
    const completed = new Set<number>();
    for (let index = 0; index < ranges.length; index += 1) { const stat = await fs.stat(partPath(index)).catch(() => null); if (stat?.isFile() && stat.size > 10_000) completed.add(index); }
    const resumed = completed.size > 0; const completedDuration = () => [...completed].reduce((sum, index) => sum + ranges[index].duration, 0); Object.assign(job, { progress: totalDuration ? completedDuration() / totalDuration * 92 : 0, speed: resumed ? `Resuming · ${completed.size}/${ranges.length} checkpoints ready` : 'Starting checkpoint 1', checkpointCompleted: completed.size, resumed });
    const saveManifest = () => atomicWriteJson(manifestPath, { version: 1, fingerprint, updatedAt: new Date().toISOString(), completed: [...completed].sort((a, b) => a - b), ranges });
    try {
      await saveManifest();
      for (let index = 0; index < ranges.length; index += 1) {
        if (job.stopRequested) { job.state = 'stopped'; job.speed = 'Stopped · checkpoints saved'; return; }
        if (completed.has(index)) continue; const range = ranges[index]; const partialPath = `${partPath(index)}.partial.mp4`; await fs.rm(partialPath, { force: true }); job.speed = `Checkpoint ${index + 1}/${ranges.length}`;
        try { await runTrackedExportProcess(projectId, command, options.buildPartArgs(range, partialPath), (seconds, speed, frame) => { job.progress = totalDuration ? Math.min(92, (completedDuration() + Math.min(range.duration, Math.max(0, seconds))) / totalDuration * 92) : 0; job.speed = `Checkpoint ${index + 1}/${ranges.length}${speed ? ` · ${speed}` : ''}`; job.frame = frame; }); }
        catch (error) { await fs.rm(partialPath, { force: true }); if (job.stopRequested) { job.state = 'stopped'; job.speed = 'Stopped · checkpoints saved'; job.checkpointCompleted = completed.size; return; } throw error; }
        await fs.rename(partialPath, partPath(index)); completed.add(index); job.checkpointCompleted = completed.size; await saveManifest();
      }
      if (job.stopRequested) { job.state = 'stopped'; job.speed = 'Stopped · checkpoints saved'; return; }
      const concatPath = path.join(sessionDir, 'parts.txt'); const joinedVideo = path.join(sessionDir, 'joined-video.mp4'); const audioPath = path.join(sessionDir, 'audio.m4a'); await fs.writeFile(concatPath, `${ranges.map((_range, index) => `file '${partPath(index).replaceAll("'", "'\\''")}'`).join('\n')}\n`);
      job.progress = 94; job.speed = 'Joining checkpoint video'; await runTrackedExportProcess(projectId, command, ['-f', 'concat', '-safe', '0', '-i', concatPath, '-map', '0:v:0', '-c', 'copy', joinedVideo]);
      job.progress = 96; job.speed = 'Rendering final audio'; await runTrackedExportProcess(projectId, command, options.audioArgs(audioPath));
      job.progress = 98; job.speed = 'Muxing final video'; await runTrackedExportProcess(projectId, command, ['-i', joinedVideo, '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-shortest', '-movflags', '+faststart', outputPath]);
      job.state = 'completed'; job.progress = 100; job.speed = 'Checkpoint render complete'; job.resumable = false; await fs.rm(sessionDir, { recursive: true, force: true });
    } catch (error) {
      if (job.stopRequested) { job.state = 'stopped'; job.speed = 'Stopped · checkpoints saved'; }
      else { job.state = 'failed'; job.speed = ''; job.error = error instanceof Error ? error.message : String(error); }
      job.checkpointCompleted = completed.size; await fs.rm(outputPath, { force: true }).catch(() => undefined); await saveManifest().catch(() => undefined);
    }
  })();
}
function route(handler: (req: express.Request, res: express.Response) => Promise<void>) { return (req: express.Request, res: express.Response) => { handler(req, res).catch((error) => res.status(Number(error?.status) || 500).json({ error: error instanceof Error ? error.message : String(error) })); }; }

function clipForRange(project: Project, range: { start: number; end: number }) { const clip = clipAtTimelineTime(project, Math.min(range.end - 0.0001, range.start + 0.0001)); if (!clip || range.end > clip.timelineEnd + 0.001) throw new Error('Render range crosses a source clip boundary'); return clip; }
function timelineAudioArgs(project: Project, segments: Array<{ start: number; end: number }>, outputPath: string) {
  const pieces = segments.flatMap((segment) => splitTimelineRange(project, segment.start, segment.end)); if (!pieces.length) throw new Error('The audio timeline is empty');
  const inputs = pieces.flatMap((piece) => ['-ss', piece.localStart.toFixed(6), '-t', (piece.localEnd - piece.localStart).toFixed(6), '-i', piece.clip.sourcePath]);
  if (pieces.length === 1) return [...inputs, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '256k', outputPath];
  const prepared = pieces.map((_piece, index) => `[${index}:a]asetpts=PTS-STARTPTS[a${index}]`).join(';'); const labels = pieces.map((_piece, index) => `[a${index}]`).join(''); const filter = `${prepared};${labels}concat=n=${pieces.length}:v=0:a=1[aout]`;
  return [...inputs, '-filter_complex', filter, '-map', '[aout]', '-vn', '-c:a', 'aac', '-b:a', '256k', outputPath];
}

function localPlanForClip(plan: BrollPlan, clip: ProjectClip) {
  const scenes = plan.scenes.filter((scene) => scene.enabled && scene.sourceEnd > clip.timelineStart && scene.sourceStart < clip.timelineEnd).map((scene) => ({ ...scene, sourceStart: Math.max(scene.sourceStart, clip.timelineStart) - clip.timelineStart, sourceEnd: Math.min(scene.sourceEnd, clip.timelineEnd) - clip.timelineStart }));
  return { ...plan, settings: { ...plan.settings, workflowMode: 'raw-video' as const }, scenes };
}
function presenterMatteSpecForClip(plan: BrollPlan, clip: ProjectClip): PresenterMatteSpecInput {
  const localPlan = localPlanForClip(plan, clip);
  const defaultTemplate = localPlan.settings.displayTemplate || 'full-frame';
  const windows = localPlan.scenes
    .filter((scene) => scene.enabled && (scene.imageFile || scene.videoFile) && displayTemplateNeedsPresenterMatte(scene.displayTemplate || defaultTemplate))
    .map((scene) => ({ start: scene.sourceStart, end: scene.sourceEnd }));
  return {
    fps: clip.media.frameRate || 30,
    sourceDuration: clip.media.duration,
    width: clip.media.width || 1080,
    height: clip.media.height || 1920,
    windows,
  };
}
async function ensureProjectPresenterMattes(project: Project, plan: BrollPlan, ffmpegBin: string, onProgress?: (completed: number, total: number, clip: ProjectClip) => void) {
  const result = new Map<string, string>();
  const clips = projectClips(project).filter((clip) => planNeedsPresenterMatte(localPlanForClip(plan, clip)));
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index]; onProgress?.(index, clips.length, clip); const clipDir = path.join(project.workDir, 'clips', clip.id); const matte = await ensurePresenterMatte({ workDir: clipDir, sourcePath: clip.sourcePath, proxyPath: clip.proxyPath, width: clip.media.width, height: clip.media.height, ffmpegBin, spec: presenterMatteSpecForClip(plan, clip) }); if (!matte.maskPath) throw new Error(`Presenter matte was not created for ${clip.sourceName}`); result.set(clip.id, matte.maskPath); onProgress?.(index + 1, clips.length, clip);
  }
  return result;
}

// ---- Phone/remote support: uploads replace native file pickers, exports land in the project for download.
async function uploadsDir() { return path.join(path.dirname((await resolvedSettings()).projectsDir), 'uploads'); }
/** Requests from anything but this computer (e.g. through the Cloudflare tunnel) cannot use desktop file dialogs. */
function isRemoteRequest(req: express.Request) { return !['localhost', '127.0.0.1', '::1', '[::1]'].includes(req.hostname); }
/** Files the browser uploaded (body.uploadIds), or the desktop file picker when the request is local. */
async function uploadedOr(req: express.Request, kind: UploadKind, pick: () => Promise<string[]>) {
  const ids = Array.isArray(req.body?.uploadIds) ? req.body.uploadIds.map(String) : [];
  if (ids.length) { const dir = await uploadsDir(); return Promise.all(ids.map((id: string) => completedUploadPath(dir, id, kind))); }
  if (isRemoteRequest(req)) throw new Error('Upload the file from this device first.');
  return (await pick()).filter(Boolean);
}
const exportsDir = (project: Project) => path.join(project.workDir, 'exports');
/** Remote requests (or delivery: "download") render into the project's exports folder; local ones keep the save dialog. */
async function outputFor(req: express.Request, project: Project, defaultName: string, pick: () => Promise<string>) {
  if (req.body?.delivery === 'download' || isRemoteRequest(req)) {
    await fs.mkdir(exportsDir(project), { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    return path.join(exportsDir(project), `${stamp}-${defaultName}`);
  }
  return pick();
}
function downloadUrlFor(project: Project, outputPath?: string) {
  if (!outputPath || path.dirname(outputPath) !== exportsDir(project)) return undefined;
  return `/api/projects/${project.id}/exports/${encodeURIComponent(path.basename(outputPath))}`;
}

app.post('/api/uploads', route(async (req, res) => { const meta = await createUpload(await uploadsDir(), { name: req.body?.name, size: req.body?.size }); res.json({ id: meta.id, received: 0, size: meta.size, kind: meta.kind }); }));
app.get('/api/uploads/:uploadId', route(async (req, res) => { const meta = await readUpload(await uploadsDir(), routeParam(req.params.uploadId)); res.json({ id: meta.id, received: meta.received, size: meta.size, complete: meta.complete, kind: meta.kind }); }));
app.put('/api/uploads/:uploadId', (req, res) => {
  void (async () => {
    try {
      const meta = await appendChunk(await uploadsDir(), routeParam(req.params.uploadId), Number(req.query.offset), req);
      res.json({ id: meta.id, received: meta.received, size: meta.size, complete: meta.complete });
    } catch (error: any) {
      res.status(error?.status ?? 500).json({ error: error instanceof Error ? error.message : String(error), expected: error?.expected });
    }
  })();
});
app.get('/api/projects/:id/exports/:file', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const name = path.basename(routeParam(req.params.file));
  const file = path.join(exportsDir(project), name); const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return void res.status(404).json({ error: 'Export not found' });
  res.setHeader('Cache-Control', 'private, max-age=604800'); // names carry a timestamp: a new version is a new file
  if (req.query.inline) return void res.sendFile(file); // plays in the page's video player
  res.download(file, name.replace(/^\d{8}-\d{6}-/, ''));
}));

app.get('/api/system/status', route(async (_req, res) => { res.json(await systemStatus()); }));
app.get('/api/models/agy', route(async (_req, res) => { const settings = await resolvedSettings(); res.json({ models: await availableAgyModels(settings.agyBin) }); }));
app.get('/api/models/list', route(async (req, res) => {
  if (!isAdmin(res)) return void res.status(403).json({ error: 'Owner only.' });
  const provider = String(req.query.provider ?? ''); const kindParam = String(req.query.kind ?? 'text');
  const kind = (['text', 'tts', 'image', 'stt'].includes(kindParam) ? kindParam : 'text') as ModelKind;
  try { res.json(await listProviderModels(provider, kind, await resolvedSettings())); }
  catch (error) { res.json({ models: [], source: 'live', note: error instanceof Error ? error.message : String(error) }); }
}));
app.get('/api/models/codex', route(async (_req, res) => { const settings = await resolvedSettings(); res.json({ models: await availableCodexModels(settings.codexBin) }); }));
app.get('/api/settings', route(async (_req, res) => { const status = await systemStatus(); res.json({ ...status, overrides: { apiTextModel: localSettings.apiTextModel ?? '', apiEffort: localSettings.apiEffort ?? '', codexBin: localSettings.codexBin ?? '', claudeBin: localSettings.claudeBin ?? '', agyBin: localSettings.agyBin ?? '', sttProvider: localSettings.sttProvider ?? '', geminiSttModel: localSettings.geminiSttModel ?? '', cleanEffort: localSettings.cleanEffort ?? '', planningEffort: localSettings.planningEffort ?? '', picturesProvider: localSettings.picturesProvider ?? '', picturesModel: localSettings.picturesModel ?? '', picturesEffort: localSettings.picturesEffort ?? '', scriptProvider: localSettings.scriptProvider ?? '', scriptModel: localSettings.scriptModel ?? '', scriptEffort: localSettings.scriptEffort ?? '', cleanProvider: localSettings.cleanProvider ?? '', cleanModel: localSettings.cleanModel ?? '', planningProvider: localSettings.planningProvider ?? '', planningModel: localSettings.planningModel ?? '', codexModel: localSettings.codexModel ?? '', grokBin: localSettings.grokBin ?? '', gflowBin: localSettings.gflowBin ?? '', ffmpegBin: localSettings.ffmpegBin ?? '', ffprobeBin: localSettings.ffprobeBin ?? '', projectsDir: localSettings.projectsDir ?? '', imageProvider: localSettings.imageProvider ?? '', openAiImageModel: localSettings.openAiImageModel ?? '', geminiImageModel: localSettings.geminiImageModel ?? '', grokModel: localSettings.grokModel ?? '', grokVideoModel: localSettings.grokVideoModel ?? '', gflowProfile: localSettings.gflowProfile ?? '', gflowVideoModel: localSettings.gflowVideoModel ?? '', magnificVideoModel: localSettings.magnificVideoModel ?? '', magnificVideoEndpoint: localSettings.magnificVideoEndpoint ?? '' } }); }));
app.put('/api/settings', route(async (req, res) => {
  const body = req.body ?? {}; const previousProjectsDir = (await resolvedSettings()).projectsDir;
  if (typeof body.elevenLabsApiKey === 'string' && body.elevenLabsApiKey.trim()) localSettings.elevenLabsApiKey = body.elevenLabsApiKey.trim(); if (typeof body.openAiApiKey === 'string' && body.openAiApiKey.trim()) localSettings.openAiApiKey = body.openAiApiKey.trim(); if (typeof body.geminiApiKey === 'string' && body.geminiApiKey.trim()) localSettings.geminiApiKey = body.geminiApiKey.trim(); if (typeof body.magnificApiKey === 'string' && body.magnificApiKey.trim()) localSettings.magnificApiKey = body.magnificApiKey.trim(); if (typeof body.anthropicApiKey === 'string' && body.anthropicApiKey.trim()) localSettings.anthropicApiKey = body.anthropicApiKey.trim();
  if (typeof body.apiEffort === 'string') localSettings.apiEffort = ['low', 'medium', 'high', 'xhigh', 'max'].includes(body.apiEffort) ? body.apiEffort : undefined; if (typeof body.imageProvider === 'string') localSettings.imageProvider = providerValue(body.imageProvider);
  if (typeof body.sttProvider === 'string') localSettings.sttProvider = body.sttProvider ? sttProviderValue(body.sttProvider, 'gemini') : undefined;
  if (typeof body.picturesProvider === 'string') localSettings.picturesProvider = body.picturesProvider === 'codex' ? 'codex' : body.picturesProvider === 'claude' ? 'claude' : undefined;
  if (typeof body.picturesModel === 'string') localSettings.picturesModel = body.picturesModel.trim();
  for (const key of ['cleanEffort', 'planningEffort', 'picturesEffort', 'scriptEffort'] as const) if (typeof body[key] === 'string') localSettings[key] = ['low', 'medium', 'high', 'xhigh', 'max'].includes(body[key]) ? body[key] : undefined;
  if (typeof body.cleanProvider === 'string') localSettings.cleanProvider = textProviderValue(body.cleanProvider);
  if (typeof body.planningProvider === 'string') localSettings.planningProvider = textProviderValue(body.planningProvider);
  if (typeof body.scriptProvider === 'string') localSettings.scriptProvider = body.scriptProvider ? textProviderValue(body.scriptProvider) : undefined;
  if (typeof body.scriptModel === 'string') localSettings.scriptModel = body.scriptModel.trim();
  for (const key of ['apiTextModel', 'geminiSttModel', 'cleanModel', 'planningModel', 'codexModel', 'agyBin', 'codexBin', 'claudeBin', 'grokBin', 'gflowBin', 'ffmpegBin', 'ffprobeBin', 'projectsDir', 'openAiImageModel', 'geminiImageModel', 'grokModel', 'grokVideoModel', 'gflowProfile', 'gflowVideoModel', 'magnificVideoModel', 'magnificVideoEndpoint'] as const) if (typeof body[key] === 'string') localSettings[key] = body[key].trim() || undefined;
  capabilityCache.clear(); await saveSettings(); const nextProjectsDir = (await resolvedSettings()).projectsDir; if (nextProjectsDir !== previousProjectsDir) await hydrateProjects(true); res.json(await systemStatus());
}));

app.get('/api/projects', route(async (_req, res) => {
  await hydrateProjects(true); const user = userOf(res);
  const visible = [...projects.values()].filter((project) => user.role === 'admin' || projectWorkspaceId(project) === user.workspaceId);
  const summaries = await Promise.all(visible.map(async (project) => ({ ...await summarizeProject(project, brollPlans.get(project.id)), workspaceId: projectWorkspaceId(project), postedAt: project.postedAt, reel: await reelStatus(project) })));
  summaries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  res.json(summaries);
}));

app.post('/api/projects/select', route(async (req, res) => {
  // Auto reels re-render every clip to 1080x1920 with its own colour handling, so clips only need audio there.
  const stick = req.body?.stick === true && isAdmin(res);
  const relaxed = req.body?.auto === true || stick;
  const stickUpload = stick && Array.isArray(req.body?.uploadIds) && req.body.uploadIds.length === 1
    ? await readUpload(await uploadsDir(), String(req.body.uploadIds[0])) : undefined;
  if (stick && (!stickUpload || !['audio', 'video'].includes(stickUpload.kind))) throw new Error('Upload one voiceover or video with sound.');
  const sourcePaths = await uploadedOr(req, stickUpload?.kind ?? 'video', () => pickNativeFiles()); if (!sourcePaths.length) return void res.status(400).json({ error: 'No video clips selected' }); const probed = await Promise.all(sourcePaths.map(async (sourcePath) => withDuration(sourcePath, await probe(sourcePath)))); if (relaxed) { const silent = probed.find((item) => !item.media.audioCodec); if (silent) throw new Error(`${path.basename(silent.sourcePath)} has no audio track.`); } else assertCompatibleClips(probed);
  const settings = await resolvedSettings(); const id = randomUUID(); const workDir = path.join(settings.projectsDir, id); await fs.mkdir(workDir, { recursive: true }); const now = new Date().toISOString(); const firstName = path.basename(sourcePaths[0]);
  const clips: ProjectClip[] = probed.map((item, index) => ({ id: `clip-${String(index + 1).padStart(3, '0')}`, sourcePath: item.sourcePath, sourceName: path.basename(item.sourcePath), media: item.media, timelineStart: 0, timelineEnd: 0 }));
  // A customer's reels always go to their own account; the owner can make one for any account (default: Personal).
  const user = userOf(res); const requestedWorkspace = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
  const workspaceId = user.role === 'member' ? user.workspaceId! : (await loadWorkspaces()).workspaces.some((w) => w.id === requestedWorkspace) ? requestedWorkspace : PERSONAL_WORKSPACE.id;
  const project: Project = { id, name: firstName.replace(/\.[^.]+$/, ''), createdAt: now, updatedAt: now, sourcePath: sourcePaths[0], sourceName: firstName, clips, workDir, media: { ...probed[0].media }, workspaceId }; syncProjectTimeline(project);
  projects.set(id, project); await saveProject(project, false); res.json(await summarizeProject(project, null));
}));

app.post('/api/projects/:id/open', route(async (req, res) => {
  const id = routeParam(req.params.id); let project = projects.get(id);
  if (!project) { const settings = await resolvedSettings(); project = await loadProjectDirectory(path.join(settings.projectsDir, id)) ?? undefined; if (project) projects.set(id, project); }
  if (!project) return void res.status(404).json({ error: 'Project not found on this computer' });
  const snapshot = await loadProjectSnapshot(project); if (snapshot.broll) brollPlans.set(project.id, snapshot.broll); res.json(snapshot);
}));

app.put('/api/projects/:id/meta', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : '';
  if (name) project.name = name; await touchProject(project); res.json(await summarizeProject(project, brollPlans.get(project.id)));
}));

app.delete('/api/projects/:id', route(async (req, res) => {
  const id = routeParam(req.params.id); const project = getProject(id); projects.delete(id); brollPlans.delete(id); motionPlans.delete(id); exportJobs.delete(id); await fs.rm(project.workDir, { recursive: true, force: true }); res.json({ deleted: true, id });
}));

app.post('/api/projects/:id/relink', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const clips = projectClips(project); let target = clips[0];
  for (const clip of clips) { const available = await fs.stat(clip.sourcePath).then((stat) => stat.isFile()).catch(() => false); if (!available) { target = clip; break; } }
  const sourcePath = (await uploadedOr(req, 'video', async () => [await pickNativeFile(`Relink ${target.sourceName}`)]))[0]; if (!sourcePath) return void res.status(400).json({ error: 'Relink cancelled' }); const media = await probe(sourcePath); const durationTolerance = Math.max(1.5, (target.media.duration || 0) * 0.02); const durationMismatch = Math.abs((media.duration || 0) - (target.media.duration || 0)) > durationTolerance; const dimensionsMismatch = Boolean(target.media.width && target.media.height && media.width && media.height && (target.media.width !== media.width || target.media.height !== media.height));
  if (durationMismatch || dimensionsMismatch) return void res.status(409).json({ error: `Selected video does not match ${target.sourceName}. Expected roughly ${target.media.width || '?'}×${target.media.height || '?'} and ${target.media.duration.toFixed(1)}s.` });
  target.sourcePath = sourcePath; target.sourceName = path.basename(sourcePath); target.media = { ...target.media, ...media }; syncProjectTimeline(project); await touchProject(project); res.json(await summarizeProject(project, brollPlans.get(project.id)));
}));

app.post('/api/projects/:id/clips', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const sourcePaths = await uploadedOr(req, 'video', () => pickNativeFiles('Add one or more base clips in playback order'));
  if (!sourcePaths.length) return void res.status(400).json({ error: 'No additional video clips selected' });
  const existing = projectClips(project); const existingPaths = new Set(existing.map((clip) => path.resolve(clip.sourcePath)));
  const uniquePaths = sourcePaths.filter((sourcePath) => !existingPaths.has(path.resolve(sourcePath)));
  if (!uniquePaths.length) return void res.status(409).json({ error: 'Those clips are already in this project' });
  const added = await Promise.all(uniquePaths.map(async (sourcePath) => ({ sourcePath, media: await probe(sourcePath) })));
  assertCompatibleClips([...existing.map((clip) => ({ sourcePath: clip.sourcePath, media: clip.media })), ...added]);
  let nextNumber = existing.reduce((highest, clip) => Math.max(highest, Number(clip.id.match(/(\d+)$/)?.[1]) || 0), 0) + 1;
  project.clips = [...existing, ...added.map((item) => ({ id: `clip-${String(nextNumber++).padStart(3, '0')}`, sourcePath: item.sourcePath, sourceName: path.basename(item.sourcePath), media: item.media, timelineStart: 0, timelineEnd: 0 }))];
  syncProjectTimeline(project); await invalidateSourceDerivedState(project); res.json(await summarizeProject(project, null));
}));

app.put('/api/projects/:id/clips/order', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const clips = projectClips(project); const clipIds: string[] = Array.isArray(req.body?.clipIds) ? req.body.clipIds.map(String) : [];
  if (clipIds.length !== clips.length || new Set(clipIds).size !== clips.length || clips.some((clip) => !clipIds.includes(clip.id))) throw new Error('The clip order must contain every project clip exactly once');
  const byId = new Map(clips.map((clip) => [clip.id, clip])); project.clips = clipIds.map((id) => byId.get(id)!);
  syncProjectTimeline(project); await invalidateSourceDerivedState(project); res.json(await summarizeProject(project, null));
}));

app.delete('/api/projects/:id/clips/:clipId', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const clips = projectClips(project);
  if (clips.length <= 1) throw new Error('A project must keep at least one base clip');
  const clipId = routeParam(req.params.clipId); const clip = clips.find((candidate) => candidate.id === clipId);
  if (!clip) throw new Error('Base clip not found');
  project.clips = clips.filter((candidate) => candidate.id !== clipId); syncProjectTimeline(project);
  await fs.rm(path.join(project.workDir, 'clips', clip.id), { recursive: true, force: true });
  await invalidateSourceDerivedState(project); res.json(await summarizeProject(project, null));
}));

app.post('/api/projects/:id/prepare', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const result = await prepareProjectMedia(project, true); res.json({ proxyUrl: `/api/projects/${project.id}/proxy`, proxy: { width: result.dimensions.width, height: result.dimensions.height, fps: 30, hardware: result.hardware } });
}));
app.get('/api/projects/:id/proxy', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); if (!project.proxyPath) throw new Error('Proxy has not been generated yet'); res.sendFile(project.proxyPath); }));
app.get('/api/projects/:id/editor/base-video', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const proxy = project.proxyPath ? await fs.stat(project.proxyPath).catch(() => null) : null;
  if (proxy?.isFile()) return void res.sendFile(project.proxyPath!);
  const clips = projectClips(project);
  if (clips.length !== 1) throw new Error('Create the project proxy before using the live editor with multiple base clips.');
  const source = await fs.stat(clips[0].sourcePath).catch(() => null);
  if (!source?.isFile()) throw new Error('Base video is not available. Relink the source clip first.');
  res.sendFile(clips[0].sourcePath);
}));
app.get('/api/projects/:id/editor/base-clips/:clipId', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const clipId = routeParam(req.params.clipId);
  const clip = projectClips(project).find((candidate) => candidate.id === clipId);
  if (!clip) throw new Error('Base clip not found');
  const source = await fs.stat(clip.sourcePath).catch(() => null);
  if (!source?.isFile()) throw new Error('Base clip is not available. Relink the source media first.');
  res.sendFile(clip.sourcePath);
}));
app.get('/api/projects/:id/editor/media', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  res.json({ media: await loadEditorMedia(project.workDir) });
}));
app.post('/api/projects/:id/editor/media', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  if (req.headers['content-type'] !== 'application/octet-stream') return void res.status(415).json({ error: 'Expected raw media upload' });
  const kind = String(req.query.kind || '') as EditorMediaKind;
  const name = String(req.query.name || '');
  if (!['video', 'audio', 'image'].includes(kind) || !name) return void res.status(400).json({ error: 'Choose a supported video, audio or picture file' });
  const entry = await importEditorMedia({ workDir: project.workDir, fileName: name, kind, stream: req, probe });
  res.status(201).json({ media: entry });
}));
app.get('/api/projects/:id/editor/media/:mediaId', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const match = await resolveEditorMedia(project.workDir, routeParam(req.params.mediaId));
  if (!match) return void res.status(404).json({ error: 'Imported media was not found' });
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Accept-Ranges', 'bytes');
  res.sendFile(match.file);
}));
app.get('/api/projects/:id/editor-project', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const file = path.join(project.workDir, 'editor-project.json');
  const saved = await fs.readFile(file, 'utf8').then((value) => JSON.parse(value)).catch(() => null);
  res.json({ project: saved });
}));
app.put('/api/projects/:id/editor-project', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const editorProject = req.body?.project;
  if (!editorProject || typeof editorProject !== 'object' || !Array.isArray(editorProject.tracks)) throw new Error('Invalid CJCut editor project');
  const safe = JSON.parse(JSON.stringify(editorProject));
  await atomicWriteJson(path.join(project.workDir, 'editor-project.json'), safe);
  res.json({ project: safe, savedAt: new Date().toISOString() });
}));
app.post('/api/projects/:id/transcribe', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const transcript = await transcribeProject(project); res.json({ transcript, edl: project.edl }); }));
/** Delete-only clean with the selected text model (aggressive by default); one retry when a length target is missed. */
async function cleanProject(project: Project, intensity: ReturnType<typeof cleanIntensityValue>, target: number | undefined, owner?: CleanNotes) {
  const settings = await resolvedSettings();
  if (!project.transcript) await transcribeProject(project);
  const words = project.transcript!.words;
  const choice = textEngines(settings).clean;
  await atomicWriteJson(path.join(project.workDir, 'edl.schema.json'), EDL_SCHEMA);
  let edl = validateEdl(words, await generateStructuredText({ choice, config: settings, workDir: project.workDir, prompt: buildCleanPrompt(words, intensity, target, undefined, owner), schema: EDL_SCHEMA, outputName: 'clean-edl' }));
  const feedback = targetFeedback(keptDuration(words, edl.keepRanges), target);
  if (feedback) {
    const retry = validateEdl(words, await generateStructuredText({ choice, config: settings, workDir: project.workDir, prompt: buildCleanPrompt(words, intensity, target, feedback, owner), schema: EDL_SCHEMA, outputName: 'clean-edl-retry' }));
    if (!targetFeedback(keptDuration(words, retry.keepRanges), target) || Math.abs(keptDuration(words, retry.keepRanges) - target!) < Math.abs(keptDuration(words, edl.keepRanges) - target!)) edl = retry;
  }
  project.edl = edl;
  const wordIndex = new Map(words.map((word, i) => [word.id, i]));
  const keptText = project.edl.keepRanges.map((range: KeepRange) => words.slice(wordIndex.get(range.startWordId), wordIndex.get(range.endWordId)! + 1).map((word) => word.text).join(' ')).join(' ');
  project.edl.notes = [...(project.edl.notes ?? []), ...scanMetaText(keptText).map((finding) => formatMetaFinding(finding, 'the cleaned narration'))];
  await invalidateBroll(project); await Promise.all([atomicWriteJson(path.join(project.workDir, 'edl.json'), project.edl), touchProject(project)]);
  return { ...project.edl, keptSeconds: Math.round(keptDuration(words, project.edl.keepRanges) * 10) / 10, sourceSeconds: Math.round((words.at(-1)!.end - words[0].start) * 10) / 10, intensity, targetDurationSec: target };
}
app.post('/api/projects/:id/clean', route(async (req, res) => {
  res.json(await cleanProject(getProject(routeParam(req.params.id)), cleanIntensityValue(req.body?.intensity), targetDurationValue(req.body?.targetDurationSec)));
}));


app.put('/api/projects/:id/edl', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); if (!project.transcript) throw new Error('Missing transcript'); project.edl = validateEdl(project.transcript.words, { keepRanges: req.body?.keepRanges, notes: ['Manually adjusted'] }); await invalidateBroll(project); await atomicWriteJson(path.join(project.workDir, 'edl.json'), project.edl); res.json(project.edl); }));

app.post('/api/projects/:id/broll/plan', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const transcript = await transcribeProject(project); const requested = (req.body?.settings ?? {}) as Partial<BrollPlanSettings>; const workflowMode = ['cleaned-video', 'raw-video', 'assets-only'].includes(String(requested.workflowMode)) ? requested.workflowMode : 'cleaned-video'; const keepRanges = workflowMode === 'cleaned-video' ? project.edl?.keepRanges : undefined; const orientation = (project.media.height || 0) > (project.media.width || 0) ? 'portrait' : 'landscape'; const plan = await createBrollPlan({ textConfig: settings, workDir: project.workDir, words: transcript.words, keepRanges, orientation, settings: { ...requested, provider: requested.provider || settings.imageProvider, planningProvider: requested.planningProvider || settings.planningProvider, planningModel: requested.planningModel ?? settings.planningModel, planningEffort: requested.planningEffort ?? settings.planningEffort } }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ plan, transcript, edl: project.edl }); }));
app.get('/api/projects/:id/broll', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const cached = brollPlans.get(project.id); const plan = await reconcileBrollFiles(project, cached ?? await loadBrollPlan(project.workDir)); if (!plan) return void res.status(404).json({ error: 'B-roll plan has not been created yet' }); brollPlans.set(project.id, plan); res.json(plan); }));
app.put('/api/projects/:id/broll/settings', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const patch: Partial<Pick<BrollPlanSettings, 'provider' | 'imageModel' | 'planningProvider' | 'planningModel' | 'videoPromptProvider' | 'videoPromptModel' | 'videoProvider' | 'returnVideoWithAudio'>> = {}; if (typeof req.body?.provider === 'string') patch.provider = providerValue(req.body.provider); if (typeof req.body?.imageModel === 'string') patch.imageModel = req.body.imageModel.trim().slice(0, 120); if (typeof req.body?.planningProvider === 'string') patch.planningProvider = textProviderValue(req.body.planningProvider); if (typeof req.body?.planningModel === 'string') patch.planningModel = req.body.planningModel.trim().slice(0, 120); if (typeof req.body?.videoPromptProvider === 'string') patch.videoPromptProvider = req.body.videoPromptProvider ? textProviderValue(req.body.videoPromptProvider) : undefined; if (typeof req.body?.videoPromptModel === 'string') patch.videoPromptModel = req.body.videoPromptModel.trim().slice(0, 120); if (typeof req.body?.videoProvider === 'string') patch.videoProvider = videoProviderValue(req.body.videoProvider); if (typeof req.body?.returnVideoWithAudio === 'boolean') patch.returnVideoWithAudio = req.body.returnVideoWithAudio; const updated = await updateBrollSettings(project.workDir, plan, patch); brollPlans.set(project.id, updated); await touchProject(project); res.json(updated); }));
app.put('/api/projects/:id/broll/scenes/:sceneId', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const sceneId = routeParam(req.params.sceneId); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet');
  const displayTemplate = req.body?.displayTemplate === 'default' ? 'default' : typeof req.body?.displayTemplate === 'string' ? displayTemplateValue(req.body.displayTemplate) : undefined;
  const assetAspectRatio = ['auto', '9:16', '16:9'].includes(String(req.body?.assetAspectRatio)) ? req.body.assetAspectRatio as 'auto' | '9:16' | '16:9' : undefined;
  const scene = await updateBrollScene(project.workDir, plan, sceneId, { title: typeof req.body?.title === 'string' ? req.body.title : undefined, imagePrompt: typeof req.body?.imagePrompt === 'string' ? req.body.imagePrompt : undefined, videoPrompt: typeof req.body?.videoPrompt === 'string' ? req.body.videoPrompt : undefined, sourceStart: Number.isFinite(Number(req.body?.sourceStart)) ? Number(req.body.sourceStart) : undefined, sourceEnd: Number.isFinite(Number(req.body?.sourceEnd)) ? Number(req.body.sourceEnd) : undefined, enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined, displayTemplate, assetAspectRatio }); brollPlans.set(project.id, plan); await touchProject(project); res.json(scene);
}));
app.delete('/api/projects/:id/broll/scenes/:sceneId', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const updated = await deleteBrollScene(project.workDir, plan, routeParam(req.params.sceneId)); brollPlans.set(project.id, updated); await touchProject(project); res.json(updated); }));


async function loadProjectMotion(project: Project) {
  const cached = motionPlans.get(project.id); if (cached) return cached;
  const plan = await loadMotionPlan(project.workDir); if (plan) motionPlans.set(project.id, plan);
  return plan;
}
async function requireMotionPlan(project: Project) { const plan = await loadProjectMotion(project); if (!plan) throw new Error('Motion-graphics plan has not been created yet'); return plan; }

app.post('/api/projects/:id/motion/plan', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const transcript = await transcribeProject(project);
  const requested = (req.body?.settings ?? {}) as Partial<MotionSettings>;
  const keepRanges = req.body?.workflowMode === 'raw-video' ? undefined : project.edl?.keepRanges;
  const orientation = (project.media.height || 0) > (project.media.width || 0) ? 'portrait' : 'landscape';
  const broll = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir);
  const previous = await loadProjectMotion(project);
  const plan = await createMotionPlan({
    textConfig: settings, workDir: project.workDir, words: transcript.words, keepRanges, orientation, broll, emotionCues: previous?.emotionCues,
    settings: { ...requested, planningProvider: requested.planningProvider || settings.planningProvider, planningModel: requested.planningModel ?? settings.planningModel },
  });
  motionPlans.set(project.id, plan);
  // Emotion sounds are planned once; re-planning the graphics keeps whatever sound beats already exist. A failure here must not lose the graphics plan.
  if (plan.settings.emotionSounds && !plan.emotionCues?.length) {
    try { await planEmotionSounds({ textConfig: settings, workDir: project.workDir, plan, words: transcript.words, keepRanges }); }
    catch (error) { plan.notes.push(`Sound plan: emotion sounds could not be planned (${error instanceof Error ? error.message.split('\n')[0] : String(error)}). Use “Plan emotion sounds” to retry.`); await saveMotionPlan(project.workDir, plan); }
  }
  await touchProject(project); res.json(plan);
}));
app.post('/api/projects/:id/motion/sfx/plan', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const transcript = await transcribeProject(project);
  const requested = (req.body?.settings ?? {}) as Partial<MotionSettings>;
  const keepRanges = req.body?.workflowMode === 'raw-video' ? undefined : project.edl?.keepRanges;
  const orientation = (project.media.height || 0) > (project.media.width || 0) ? 'portrait' : 'landscape';
  const chosen = { planningProvider: requested.planningProvider || settings.planningProvider, planningModel: requested.planningModel ?? settings.planningModel };
  const existing = await loadProjectMotion(project);
  // Sounds can be planned before any graphic exists, so start from an empty plan when there is none.
  const plan = existing ?? emptyMotionPlan(orientation, { ...requested, ...chosen });
  if (existing) plan.settings = normalizeMotionSettings({ ...plan.settings, ...requested, ...chosen });
  motionPlans.set(project.id, plan);
  await planEmotionSounds({ textConfig: settings, workDir: project.workDir, plan, words: transcript.words, keepRanges });
  await touchProject(project); res.json(plan);
}));
app.post('/api/projects/:id/motion/sfx', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const plan = await requireMotionPlan(project); const body = req.body ?? {};
  const cue = await addEmotionCue(project.workDir, plan, { emotion: typeof body.emotion === 'string' ? body.emotion : undefined, soundId: typeof body.soundId === 'string' ? body.soundId : undefined, intensity: typeof body.intensity === 'string' ? body.intensity : undefined, sourceTime: Number(body.sourceTime) }, project.transcript?.words ?? []);
  await touchProject(project); res.status(201).json(cue);
}));
app.put('/api/projects/:id/motion/sfx/:cueId', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const plan = await requireMotionPlan(project); const body = req.body ?? {};
  const cue = await updateEmotionCue(project.workDir, plan, routeParam(req.params.cueId), {
    emotion: typeof body.emotion === 'string' ? body.emotion : undefined, soundId: typeof body.soundId === 'string' ? body.soundId : undefined, intensity: typeof body.intensity === 'string' ? body.intensity : undefined,
    sourceTime: body.sourceTime !== undefined && Number.isFinite(Number(body.sourceTime)) ? Number(body.sourceTime) : undefined, enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined, reason: typeof body.reason === 'string' ? body.reason : undefined,
  }, project.transcript?.words ?? []);
  await touchProject(project); res.json(cue);
}));
app.delete('/api/projects/:id/motion/sfx/:cueId', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const plan = await requireMotionPlan(project);
  await deleteEmotionCue(project.workDir, plan, routeParam(req.params.cueId)); await touchProject(project); res.json(plan);
}));
app.get('/api/motion-sounds', (_req, res) => { res.json({ sounds: MOTION_SOUNDS, emotions: EMOTIONS }); });
app.get('/api/motion-sounds/:soundId/audio', route(async (req, res) => { res.sendFile(motionSoundPath(routeParam(req.params.soundId))); }));
app.get('/api/motion-templates', route(async (_req, res) => { res.json({ templates: await listMotionTemplates() }); }));
app.post('/api/motion-templates', route(async (req, res) => {
  if (req.headers['content-type'] !== 'application/octet-stream') return void res.status(415).json({ error: 'Expected raw image upload' });
  const fileName = String(req.query.fileName || ''); if (!fileName) return void res.status(400).json({ error: 'Choose a template image' });
  res.status(201).json(await addMotionTemplate({ fileName, name: String(req.query.name || ''), notes: String(req.query.notes || ''), stream: req }));
}));
app.put('/api/motion-templates/:templateId', route(async (req, res) => { res.json(await updateMotionTemplate(routeParam(req.params.templateId), { name: req.body?.name, notes: req.body?.notes })); }));
app.delete('/api/motion-templates/:templateId', route(async (req, res) => { await deleteMotionTemplate(routeParam(req.params.templateId)); res.json({ deleted: true }); }));
app.get('/api/motion-templates/:templateId/image', route(async (req, res) => {
  const found = await motionTemplatePath(routeParam(req.params.templateId)); if (!found) return void res.status(404).json({ error: 'Template not found' });
  res.type(MOTION_TEMPLATE_MIME[found.entry.file.split('.').pop()!] || 'image/png'); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); res.sendFile(found.file);
}));
app.get('/api/projects/:id/motion', route(async (req, res) => { const plan = await loadProjectMotion(getProject(routeParam(req.params.id))); if (!plan) return void res.status(404).json({ error: 'Motion-graphics plan has not been created yet' }); res.json(plan); }));
app.put('/api/projects/:id/motion/settings', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const plan = await requireMotionPlan(project);
  const patch = normalizeMotionSettings({ ...plan.settings, ...(req.body ?? {}) });
  const updated = await updateMotionSettings(project.workDir, plan, patch); motionPlans.set(project.id, updated); await touchProject(project); res.json(updated);
}));
app.put('/api/projects/:id/motion/scenes/:sceneId', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const plan = await requireMotionPlan(project); const body = req.body ?? {};
  if (plan.scenes.find((scene) => scene.id === routeParam(req.params.sceneId))?.status === 'generating') throw new Error('Wait for this graphic to finish rendering before editing it.');
  const patch: MotionScenePatch = {
    title: typeof body.title === 'string' ? body.title : undefined, enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    sourceStart: Number.isFinite(Number(body.sourceStart)) && body.sourceStart !== undefined ? Number(body.sourceStart) : undefined,
    sourceEnd: Number.isFinite(Number(body.sourceEnd)) && body.sourceEnd !== undefined ? Number(body.sourceEnd) : undefined,
    templateId: typeof body.templateId === 'string' ? body.templateId : body.templateId === null ? null : undefined,
    graphicType: typeof body.graphicType === 'string' ? body.graphicType : undefined, placement: typeof body.placement === 'string' ? body.placement : undefined,
    headline: typeof body.headline === 'string' ? body.headline : undefined, subhead: typeof body.subhead === 'string' ? body.subhead : undefined,
    items: Array.isArray(body.items) ? body.items.map((item: any) => ({ label: String(item?.label ?? ''), value: String(item?.value ?? '') })) : undefined,
    designBrief: typeof body.designBrief === 'string' ? body.designBrief : undefined,
    soundEffects: Array.isArray(body.soundEffects) ? body.soundEffects : undefined,
  };
  const broll = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir);
  const scene = await updateMotionScene(project.workDir, plan, routeParam(req.params.sceneId), patch, broll); await touchProject(project); res.json(scene);
}));
app.delete('/api/projects/:id/motion/scenes/:sceneId', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const plan = await requireMotionPlan(project);
  if (plan.scenes.find((scene) => scene.id === routeParam(req.params.sceneId))?.status === 'generating') throw new Error('Wait for this graphic to finish rendering before deleting it.');
  res.json(await deleteMotionScene(project.workDir, plan, routeParam(req.params.sceneId)));
}));
const motionRenderControllers = new Map<string, AbortController>();
app.post('/api/projects/:id/motion/stop', route(async (req, res) => {
  const projectId = routeParam(req.params.id); const only = typeof req.body?.sceneId === 'string' ? req.body.sceneId : '';
  let stopped = 0; for (const [key, controller] of motionRenderControllers) if (key.startsWith(`${projectId}:`) && (!only || key === `${projectId}:${only}`)) { controller.abort(); stopped += 1; }
  res.json({ stopped });
}));
app.post('/api/projects/:id/motion/scenes/:sceneId/generate', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const plan = await requireMotionPlan(project); const sceneId = routeParam(req.params.sceneId); const settings = await resolvedSettings();
  const scene = plan.scenes.find((candidate) => candidate.id === sceneId); if (!scene) throw new Error('Motion graphic not found');
  if (scene.status === 'generating') return void res.status(409).json({ error: 'This graphic is already rendering' });
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.slice(0, 1200) : undefined;
  const controller = new AbortController(); const key = `${project.id}:${sceneId}`; motionRenderControllers.set(key, controller);
  try {
    const generated = await generateMotionScene({ textConfig: settings, workDir: project.workDir, plan, sceneId, chromeBin: await detectChromeBin(), ffmpegBin: settings.ffmpegBin, regenerateCode: req.body?.regenerateCode === true, comment, signal: controller.signal });
    await touchProject(project); res.json(generated);
  } finally { motionRenderControllers.delete(key); }
}));
app.get('/api/projects/:id/motion/scenes/:sceneId/video', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const plan = await requireMotionPlan(project);
  const scene = plan.scenes.find((candidate) => candidate.id === routeParam(req.params.sceneId));
  if (!scene?.videoFile) return void res.status(404).json({ error: 'Motion graphic has not been rendered yet' });
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); res.type('video/webm'); res.sendFile(scene.videoFile);
}));

app.get('/api/projects/:id/thumbnail', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  res.json(thumbnailStateView(await loadThumbnailState(project.workDir)));
}));
app.post('/api/projects/:id/thumbnail/references', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const settings = await resolvedSettings();
  const sourcePaths = await uploadedOr(req, 'image', () => pickNativeImageFiles());
  if (!sourcePaths.length) return void res.status(400).json({ error: 'No thumbnail references selected' });
  const state = await replaceThumbnailReferences({ workDir: project.workDir, sourcePaths, ffmpegBin: settings.ffmpegBin });
  await touchProject(project);
  res.json(thumbnailStateView(state));
}));
app.post('/api/projects/:id/thumbnail/generate', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const settings = await resolvedSettings();
  const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir);
  const provider = plan?.settings.provider || settings.imageProvider;
  const hook = typeof req.body?.hook === 'string' ? req.body.hook.trim().slice(0, 200) : undefined;
  const transcript = project.transcript?.text || project.transcript?.words?.map((word) => word.text).join(' ') || project.name;
  const state = await generateProjectThumbnail({
    workDir: project.workDir,
    projectName: project.name,
    transcript,
    hook,
    provider,
    config: {
      geminiApiKey: settings.geminiApiKey,
      geminiModel: (provider === 'gemini' && plan?.settings.imageModel?.trim()) || settings.geminiImageModel,
      codexBin: settings.codexBin,
      codexModel: (provider === 'codex-cli' && plan?.settings.imageModel?.trim()) || settings.codexModel,
      ffmpegBin: settings.ffmpegBin,
    },
  });
  await touchProject(project);
  res.json(thumbnailStateView(state));
}));
app.get('/api/projects/:id/thumbnail/image', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const file = await thumbnailImageFile(project.workDir);
  if (!file) return void res.status(404).json({ error: 'Thumbnail has not been generated yet' });
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(file);
}));
app.get('/api/projects/:id/thumbnail/references/:referenceId', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const file = await thumbnailReferenceFile(project.workDir, routeParam(req.params.referenceId));
  if (!file) return void res.status(404).json({ error: 'Thumbnail reference not found' });
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(file);
}));

app.get('/api/projects/:id/presenter-matte', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan || !planNeedsPresenterMatte(plan)) return void res.json({ ready: false, stale: false }); const statuses = [];
  for (const clip of projectClips(project)) { const clipPlan = localPlanForClip(plan, clip); if (planNeedsPresenterMatte(clipPlan)) statuses.push(await presenterMatteStatus(path.join(project.workDir, 'clips', clip.id), clip.sourcePath, presenterMatteSpecForClip(plan, clip))); }
  res.json({ ready: statuses.length > 0 && statuses.every((status) => status.ready), stale: statuses.some((status) => status.stale), generatedAt: statuses.map((status) => status.generatedAt).filter(Boolean).sort().at(-1) });
}));
app.post('/api/projects/:id/presenter-matte', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); await requireSource(project); const settings = await resolvedSettings(); if (!settings.ffmpegBin) throw new Error('FFmpeg was not found.'); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan || !planNeedsPresenterMatte(plan)) return void res.json({ ready: false, stale: false }); const mattes = await ensureProjectPresenterMattes(project, plan, settings.ffmpegBin); await touchProject(project); res.json({ ready: mattes.size > 0, stale: false, generatedAt: new Date().toISOString(), clips: mattes.size });
}));

app.post('/api/projects/:id/broll/scenes/:sceneId/generate', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const sceneId = routeParam(req.params.sceneId); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet');
  const regenerationComment = typeof req.body?.regenerationComment === 'string' ? req.body.regenerationComment.trim().slice(0, 2000) : undefined;
  const scene = await generateBrollImage({ workDir: project.workDir, plan, sceneId, regenerationComment, config: { openAiApiKey: settings.openAiApiKey, openAiModel: settings.openAiImageModel, geminiApiKey: settings.geminiApiKey, geminiModel: settings.geminiImageModel, grokBin: settings.grokBin, grokModel: settings.grokModel, grokVideoModel: settings.grokVideoModel, codexBin: settings.codexBin, codexModel: settings.codexModel, ffmpegBin: settings.ffmpegBin, claudeBin: settings.claudeBin, picturesEngine: picturesEngine(settings) } }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ scene, imageUrl: `/api/projects/${project.id}/broll/scenes/${scene.id}/image?v=${encodeURIComponent(scene.generatedAt ?? '')}` });
}));
app.post('/api/projects/:id/broll/scenes/:sceneId/manual-image', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const sourcePath = (await uploadedOr(req, 'image', async () => [await pickNativeImageFile()]))[0]; if (!sourcePath) return void res.status(400).json({ error: 'No image selected' }); const scene = await importBrollImage({ workDir: project.workDir, plan, sceneId: routeParam(req.params.sceneId), sourcePath, ffmpegBin: settings.ffmpegBin }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ scene, imageUrl: `/api/projects/${project.id}/broll/scenes/${scene.id}/image?v=${encodeURIComponent(scene.generatedAt ?? '')}` }); }));
app.post('/api/projects/:id/broll/scenes/:sceneId/manual-video', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const sourcePath = (await uploadedOr(req, 'video', async () => [await pickNativeFile('Choose a completed B-roll video')]))[0]; if (!sourcePath) return void res.status(400).json({ error: 'No video selected' }); const media = await probe(sourcePath); if (!media.videoCodec) throw new Error('The selected file does not contain a video stream.'); const scene = await importBrollVideo({ workDir: project.workDir, plan, sceneId: routeParam(req.params.sceneId), sourcePath, ffmpegBin: settings.ffmpegBin }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ scene, videoUrl: `/api/projects/${project.id}/broll/scenes/${scene.id}/video?v=${encodeURIComponent(scene.videoGeneratedAt ?? '')}` }); }));
app.get('/api/projects/:id/broll/scenes/:sceneId/image', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const loaded = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); const plan = await reconcileBrollFiles(project, loaded); const scene = plan?.scenes.find((candidate) => candidate.id === routeParam(req.params.sceneId)); const imagePath = scene ? await resolveBrollAssetPath(project.workDir, scene, 'image') : undefined; if (!plan || !scene || !imagePath) return void res.status(404).json({ error: 'B-roll image has not been generated yet' }); brollPlans.set(project.id, plan); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); res.sendFile(imagePath); }));

app.post('/api/projects/:id/broll/scenes/:sceneId/fix-meta', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings();
  const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet');
  const scene = await fixSceneForMetaPolicy({ textConfig: settings, workDir: project.workDir, plan, sceneId: routeParam(req.params.sceneId), config: { openAiApiKey: settings.openAiApiKey, openAiModel: settings.openAiImageModel, geminiApiKey: settings.geminiApiKey, geminiModel: settings.geminiImageModel, grokBin: settings.grokBin, grokModel: settings.grokModel, grokVideoModel: settings.grokVideoModel, codexBin: settings.codexBin, codexModel: settings.codexModel, ffmpegBin: settings.ffmpegBin, claudeBin: settings.claudeBin, picturesEngine: picturesEngine(settings) } });
  brollPlans.set(project.id, plan); await touchProject(project); res.json(scene);
}));
app.post('/api/projects/:id/broll/scenes/:sceneId/video-prompt', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const sceneId = routeParam(req.params.sceneId); if (plan.scenes.find(candidate => candidate.id === sceneId)?.videoTreatment === 'still') throw new Error('This scene uses a still motion effect and does not need a video prompt.'); const scene = await createVideoPrompt({ textConfig: settings, workDir: project.workDir, plan, sceneId }); brollPlans.set(project.id, plan); await touchProject(project); res.json(scene); }));
app.post('/api/projects/:id/broll/scenes/:sceneId/still-effect', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings();
  const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet');
  const effect = String(req.body?.effect);
  if (!['ai', 'hold', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right'].includes(effect)) throw new Error('Choose a supported still motion effect.');
  const scene = await setStillEffect({ workDir: project.workDir, plan, sceneId: routeParam(req.params.sceneId), effect: effect as import('./broll.js').StillEffect | 'ai', ffmpegBin: settings.ffmpegBin });
  brollPlans.set(project.id, plan); await touchProject(project); res.json(scene);
}));
app.post('/api/projects/:id/broll/scenes/:sceneId/video', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const sceneId = routeParam(req.params.sceneId); let scene = plan.scenes.find((candidate) => candidate.id === sceneId); if (!scene) throw new Error('B-roll scene not found'); if (scene.videoTreatment === 'still') throw new Error('This scene uses a still motion effect. Switch it to AI video before generating.'); if (!scene.videoPrompt) { scene = await createVideoPrompt({ textConfig: settings, workDir: project.workDir, plan, sceneId }); }
  const regenerationComment = typeof req.body?.regenerationComment === 'string' ? req.body.regenerationComment.trim().slice(0, 2000) : undefined;
  const videoProvider = plan.settings.videoProvider || 'grok-cli';
  scene = videoProvider === 'google-flow'
    ? await generateBrollVideoWithGoogleFlow({ workDir: project.workDir, projectName: project.name, plan, sceneId, regenerationComment, config: { gflowBin: settings.gflowBin, gflowProfile: settings.gflowProfile, gflowVideoModel: settings.gflowVideoModel, codexBin: settings.codexBin, ffmpegBin: settings.ffmpegBin } })
    : videoProvider === 'magnific'
      ? await generateBrollVideoWithMagnific({ workDir: project.workDir, plan, sceneId, regenerationComment, config: { magnificApiKey: settings.magnificApiKey, magnificVideoModel: settings.magnificVideoModel, magnificVideoEndpoint: settings.magnificVideoEndpoint, ffmpegBin: settings.ffmpegBin } })
      : await generateBrollVideoWithGrokCli({ workDir: project.workDir, plan, sceneId, regenerationComment, config: { grokBin: settings.grokBin, grokModel: settings.grokModel, grokVideoModel: settings.grokVideoModel, codexBin: settings.codexBin, ffmpegBin: settings.ffmpegBin } }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ scene, videoUrl: `/api/projects/${project.id}/broll/scenes/${scene.id}/video?v=${encodeURIComponent(scene.videoGeneratedAt ?? '')}` });
}));
app.post('/api/projects/:id/broll/google-flow/sync', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const unmatched = await listGoogleFlowProjectVideos({ workDir: project.workDir, plan, config: { gflowBin: settings.gflowBin, gflowProfile: settings.gflowProfile, ffmpegBin: settings.ffmpegBin } }); brollPlans.set(project.id, plan); res.json({ plan, unmatched }); }));
app.post('/api/projects/:id/broll/google-flow/assign', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet'); const mediaId = String(req.body?.mediaId ?? ''); const sceneId = String(req.body?.sceneId ?? ''); const videos = await listGoogleFlowProjectVideos({ workDir: project.workDir, plan, config: { gflowBin: settings.gflowBin, gflowProfile: settings.gflowProfile, ffmpegBin: settings.ffmpegBin } }); const video = videos.find((candidate) => candidate.mediaId === mediaId); if (!video) throw new Error('That Flow video is already assigned or was not found in this project. Sync and try again.'); if (!video.localPath || !(await fs.stat(video.localPath).catch(() => null))?.isFile()) throw new Error('This Flow video is not downloaded locally. Download it from Flow, then use “Add video manually” on the scene.'); const scene = await importBrollVideo({ workDir: project.workDir, plan, sceneId, sourcePath: video.localPath, ffmpegBin: settings.ffmpegBin, source: 'flow-catalog', flowMediaId: video.mediaId }); brollPlans.set(project.id, plan); await touchProject(project); res.json({ scene, videoUrl: `/api/projects/${project.id}/broll/scenes/${scene.id}/video?v=${encodeURIComponent(scene.videoGeneratedAt ?? '')}` }); }));
app.get('/api/projects/:id/broll/scenes/:sceneId/video', route(async (req, res) => { const project = getProject(routeParam(req.params.id)); const loaded = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); const plan = await reconcileBrollFiles(project, loaded); const scene = plan?.scenes.find((candidate) => candidate.id === routeParam(req.params.sceneId)); const videoPath = scene ? await resolveBrollAssetPath(project.workDir, scene, 'video') : undefined; if (!plan || !scene || !videoPath) return void res.status(404).json({ error: 'B-roll video has not been created yet' }); brollPlans.set(project.id, plan); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); res.sendFile(videoPath); }));
app.post('/api/projects/:id/broll/scenes/:sceneId/preview', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); await requireSource(project); const settings = await resolvedSettings(); if (!settings.ffmpegBin) throw new Error('FFmpeg was not found'); const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!plan) throw new Error('B-roll plan has not been created yet');
  const sceneId = routeParam(req.params.sceneId); const result = await renderBrollScenePreview(project, plan, sceneId, settings.ffmpegBin); res.json({ previewUrl: `/api/projects/${project.id}/broll/scenes/${sceneId}/preview?v=${result.cacheKey}`, duration: result.duration, cached: result.cached });
}));
app.get('/api/projects/:id/broll/scenes/:sceneId/preview', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const previewPath = path.join(project.workDir, 'previews', routeParam(req.params.sceneId), 'preview.mp4'); const stat = await fs.stat(previewPath).catch(() => null); if (!stat?.isFile() || stat.size < 10_000) return void res.status(404).json({ error: 'B-roll scene preview has not been rendered yet' }); res.setHeader('Cache-Control', 'private, no-cache'); res.sendFile(previewPath);
}));
app.post('/api/projects/:id/broll/preview', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const settings = await resolvedSettings(); if (!settings.ffmpegBin) throw new Error('FFmpeg was not found');
  const loaded = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); const plan = await reconcileBrollFiles(project, loaded); if (!plan) throw new Error('B-roll plan has not been created yet');
  brollPlans.set(project.id, plan); const result = await renderBrollProjectPreview(project, plan, settings.ffmpegBin);
  res.json({ previewUrl: `/api/projects/${project.id}/broll/preview?v=${result.cacheKey}`, duration: result.duration, cached: result.cached, sceneCount: result.sceneCount });
}));
app.get('/api/projects/:id/broll/preview', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const previewPath = path.join(project.workDir, 'previews', 'project', 'preview.mp4'); const stat = await fs.stat(previewPath).catch(() => null);
  if (!stat?.isFile() || stat.size < 10_000) return void res.status(404).json({ error: 'Complete B-roll preview has not been rendered yet' });
  res.setHeader('Cache-Control', 'private, no-cache'); res.sendFile(previewPath);
}));

app.post('/api/projects/:id/broll/export-assets', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const loaded = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); const plan = await reconcileBrollFiles(project, loaded); if (!plan) throw new Error('B-roll plan has not been created yet'); brollPlans.set(project.id, plan); const selectedFolder = await pickFolderPath(); if (!selectedFolder) return void res.status(400).json({ error: 'Export cancelled' }); const destination = path.join(selectedFolder, `video-cleaner-broll-${project.id.slice(0, 8)}`); await fs.mkdir(destination, { recursive: true }); const scenes = [];
  for (const scene of plan.scenes) { let imageFile: string | null = null; let videoFile: string | null = null; const imagePath = await resolveBrollAssetPath(project.workDir, scene, 'image'); const videoPath = await resolveBrollAssetPath(project.workDir, scene, 'video'); if (imagePath) { imageFile = `${scene.id}${path.extname(imagePath).toLowerCase() || '.png'}`; await fs.copyFile(imagePath, path.join(destination, imageFile)); } if (videoPath) { videoFile = `${scene.id}${path.extname(videoPath).toLowerCase() || '.mp4'}`; await fs.copyFile(videoPath, path.join(destination, videoFile)); } scenes.push({ id: scene.id, title: scene.title, enabled: scene.enabled, sourceStart: scene.sourceStart, sourceEnd: scene.sourceEnd, startWordId: scene.startWordId, endWordId: scene.endWordId, narration: scene.narration, visualIntent: scene.visualIntent, shotType: scene.shotType, imagePrompt: scene.imagePrompt, videoPrompt: scene.videoPrompt || null, displayTemplate: scene.displayTemplate || plan.settings.displayTemplate || 'full-frame', assetAspectRatio: scene.assetAspectRatio || 'auto', generatedAspectRatio: scene.generatedAspectRatio || null, orientationChanged: Boolean(scene.orientationChanged), provider: scene.provider || plan.settings.provider, model: scene.model || null, imageFile, videoFile, videoModel: scene.videoModel || null }); }
  const timing = { version: 2, sourceName: project.sourceName, clips: projectClips(project).map((clip) => ({ id: clip.id, sourceName: clip.sourceName, timelineStart: clip.timelineStart, timelineEnd: clip.timelineEnd })), workflowMode: plan.settings.workflowMode, orientation: plan.orientation, settings: plan.settings, scenes }; await atomicWriteJson(path.join(destination, 'broll-timing.json'), timing); await fs.writeFile(path.join(destination, 'README.txt'), 'B-roll images/videos and editable timing data exported by Video Cleaner. Edit broll-timing.json or import the files into any editor.\n'); res.json({ destination, sceneCount: scenes.length });
}));

app.post('/api/projects/:id/export-project-zip', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  const exportOptions = normalizeProjectExportOptions(req.body?.options);
  if (!Object.values(exportOptions).some(Boolean)) throw new Error('Select at least one item to export.');
  const plan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir);
  const baseName = project.name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'video-cleaner-project';
  const selectedPath = await outputFor(req, project, `${baseName}.zip`, () => pickZipPath(`${baseName}.zip`)); if (!selectedPath) return void res.status(400).json({ error: 'Export cancelled' });
  const destination = selectedPath.toLowerCase().endsWith('.zip') ? selectedPath : `${selectedPath}.zip`;
  const result = await exportProjectZip({ project, plan: plan ?? null, destination, exportOptions });
  res.json({ ...result, downloadUrl: downloadUrlFor(project, destination) });
}));

app.post('/api/projects/:id/editor/export-video', route(async (req, res) => {
  const projectId = routeParam(req.params.id);
  const project = getProject(projectId);
  await requireSource(project);
  const settings = await resolvedSettings();
  if (!settings.ffmpegBin) throw new Error('FFmpeg was not found');
  if (exportJobs.get(projectId)?.state === 'running') return void res.status(409).json({ error: 'A render is already running for this project' });
  const savedPath = path.join(project.workDir, 'editor-project.json');
  const timeline = await fs.readFile(savedPath, 'utf8').then(value => JSON.parse(value)).catch(() => null);
  if (!timeline?.tracks?.length) throw new Error('No saved CJCut timeline. Save it in Live Editor first.');
  const outputPath = await outputFor(req, project, 'video-cjcut-edited.mp4', () => pickExportPath('video-cjcut-edited.mp4', 'Export edited timeline from CJCut'));
  if (!outputPath) return void res.status(400).json({ error: 'Export cancelled' });
  const mode: 'fast' | 'quality' = req.body?.mode === 'fast' ? 'fast' : 'quality';
  const capabilities = await ffmpegCapabilities(settings.ffmpegBin);
  // The editor compositor produces an SDR yuv420p canvas. Use the same
  // VideoToolbox-aware encoder selection as the original Video Cleaner exports.
  const encoding = encodingArgs(project, capabilities, mode, true);
  const inputVideoArgs = capabilities.videoToolboxDecode ? ['-hwaccel', 'videotoolbox'] : [];
  const job: ExportJob = {
    state: 'running', progress: 0, outTime: '00:00:00.000000', speed: 'Preparing CJCut layers…',
    frame: 0, outputPath, encoder: encoding.encoder, resumable: false, startedAt: Date.now(),
  };
  exportJobs.set(projectId, job);
  void (async () => {
    try {
      const broll = brollPlans.get(projectId) ?? await loadBrollPlan(project.workDir);
      const motion = motionPlans.get(projectId) ?? await loadMotionPlan(project.workDir);
      const renderWorkDir = path.join(project.workDir, 'editor-render');
      const render = await buildEditorRender({
        project, timeline, broll, motion, ffmpegBin: settings.ffmpegBin!, outputPath, workDir: renderWorkDir, mode,
        inputVideoArgs, outputVideoArgs: encoding.args, outputColorArgs: bt709ColorArgs(),
        probe: async file => probe(file),
      });
      if (job.stopRequested) { job.state = 'stopped'; job.speed = 'Stopped before encoding'; return; }
      job.speed = `Rendering ${render.visualClips} visual / ${render.audioClips} audio clips…`;
      await runTrackedExportProcess(projectId, settings.ffmpegBin!, render.args, (elapsed, speed, frame) => {
        job.progress = Math.min(99, elapsed / render.duration * 100);
        job.outTime = new Date(Math.max(0, Math.round(elapsed * 1000))).toISOString().slice(11, 23);
        job.speed = speed || 'Rendering CJCut timeline…';
        job.frame = frame;
      });
      if (job.stopRequested) { job.state = 'stopped'; job.speed = 'Stopped'; await fs.rm(outputPath, { force: true }); return; }
      const output = await fs.stat(outputPath).catch(() => null);
      if (!output?.isFile() || output.size < 1000) throw new Error('CJCut render finished without a usable MP4');
      job.state = 'completed'; job.progress = 100; job.speed = 'Completed';
    } catch (error) {
      if (job.stopRequested) { job.state = 'stopped'; job.speed = 'Stopped'; }
      else { job.state = 'failed'; job.error = error instanceof Error ? error.message : String(error); job.speed = ''; }
      await fs.rm(outputPath, { force: true }).catch(() => undefined);
    }
  })();
  res.status(202).json({ started: true, outputPath, encoder: encoding.encoder, hardware: encoding.hardware, targetBitRate: encoding.targetBitRate, editorTimeline: true });
}));

app.post('/api/projects/:id/broll/export-video', route(async (req, res) => {
  const projectId = routeParam(req.params.id); const project = getProject(projectId); await requireSource(project); const settings = await resolvedSettings(); const storedPlan = brollPlans.get(project.id) ?? await loadBrollPlan(project.workDir); if (!storedPlan) throw new Error('B-roll plan has not been created yet'); if (storedPlan.settings.workflowMode === 'assets-only') throw new Error('Assets-only projects export files and timing JSON, not a rendered video'); if (!settings.ffmpegBin) throw new Error('FFmpeg was not found');
  const active = exportJobs.get(projectId); if (active?.state === 'running') return void res.status(409).json({ error: 'An export is already running for this project' }); const outputPath = await outputFor(req, project, 'video-with-broll.mp4', () => pickExportPath('video-with-broll.mp4', 'Export video with B-roll')); if (!outputPath) return void res.status(400).json({ error: 'Export cancelled' }); const plan = storedPlan;
  const mode: 'fast' | 'quality' = req.body?.mode === 'fast' ? 'fast' : 'quality'; const fps = project.media.frameRate && project.media.frameRate > 0 ? project.media.frameRate : 30; const cleanedSegments = plan.settings.workflowMode === 'cleaned-video' ? rangesToSeconds(project) : undefined; const rawSegments = cleanedSegments?.length ? cleanedSegments : [{ start: 0, end: project.media.duration }]; const sourceSegments = splitSegmentsAtClipBoundaries(project, rawSegments);
  const activeScenes = plan.scenes.filter((scene) => scene.enabled && (scene.videoFile || scene.imageFile)); const needsPresenterMatte = planNeedsPresenterMatte(plan);
  const capabilities = await ffmpegCapabilities(settings.ffmpegBin); const outputHdr = project.media.hdr; const encoding = encodingArgs(project, capabilities, mode, !outputHdr); const inputAcceleration = capabilities.videoToolboxDecode ? ['-hwaccel', 'videotoolbox'] : []; const ranges = checkpointRanges(sourceSegments, activeScenes); if (!ranges.length) throw new Error('The export timeline is empty');
  const preparingJob: ExportJob = { state: 'running', progress: 0, outTime: '00:00:00.000000', speed: needsPresenterMatte ? 'Preparing presenter cutouts…' : 'Preparing render checkpoints…', frame: 0, outputPath, encoder: encoding.encoder, checkpointCompleted: 0, checkpointTotal: ranges.length, resumable: false, startedAt: Date.now() }; exportJobs.set(projectId, preparingJob);

  void (async () => {
    try {
      const mattePaths = needsPresenterMatte ? await ensureProjectPresenterMattes(project, plan, settings.ffmpegBin!, (completed, total, clip) => {
        preparingJob.speed = `Preparing presenter cutouts ${Math.min(completed + 1, total)}/${total} · ${clip.sourceName}`;
      }) : new Map<string, string>();
      const assetColors: Record<string, MediaProfile> = {};
      for (const scene of activeScenes) assetColors[scene.id] = await probe((scene.videoFile || scene.imageFile)!);
      const sourceMedia = new Map<string, MediaProfile>();
      for (const clip of projectClips(project)) sourceMedia.set(clip.id, await probe(clip.sourcePath));
      preparingJob.speed = 'Preparing render checkpoints…';
      const fingerprint = await checkpointFingerprint({ project, plan, mattePaths: [...mattePaths.values()], mode, segments: sourceSegments, encodingArgs: encoding.args, fps }); const checkpointRoot = path.join(project.workDir, 'render-checkpoints'); const sessionDir = path.join(checkpointRoot, fingerprint); await fs.mkdir(checkpointRoot, { recursive: true });
      for (const entry of await fs.readdir(checkpointRoot, { withFileTypes: true })) if (entry.isDirectory() && entry.name !== fingerprint) await fs.rm(path.join(checkpointRoot, entry.name), { recursive: true, force: true }); await fs.mkdir(sessionDir, { recursive: true });
      const buildPartArgs = (range: CheckpointRange, partOutputPath: string) => {
        const clip = clipForRange(project, range); const localStart = range.start - clip.timelineStart; const prepared = activeScenes.filter((scene) => scene.sourceEnd > range.start && scene.sourceStart < range.end).map((scene) => ({ original: scene, local: { ...scene, sourceStart: Math.max(scene.sourceStart, range.start) - range.start, sourceEnd: Math.min(scene.sourceEnd, range.end) - range.start } })); const chunkPlan: BrollPlan = { ...plan, settings: { ...plan.settings, workflowMode: 'raw-video' }, scenes: prepared.map((item) => item.local) }; const needsPresenter = planNeedsPresenterMatte(chunkPlan); const currentMedia = sourceMedia.get(clip.id) ?? clip.media; const baseVideoFilter = [rotationFilter(currentMedia.rotation), colorVideoFilter(currentMedia, outputHdr)].filter(Boolean).join(','); const filter = prepared.length ? buildBrollOverlayFilter({ plan: chunkPlan, width: project.media.width || 1920, height: project.media.height || 1080, fps, presenterInputIndex: needsPresenter ? prepared.length + 1 : undefined, includeAudio: false, baseVideoFilter, outputHdr, assetColors }).filter : `[0:v]${baseVideoFilter},setpts=PTS-STARTPTS[vout]`;
        const brollInputs = prepared.flatMap(({ original }) => { const offset = Math.max(0, range.start - original.sourceStart); return original.videoFile ? ['-stream_loop', '-1', ...(offset > 0.001 ? ['-ss', offset.toFixed(6)] : []), ...inputAcceleration, '-i', original.videoFile] : ['-loop', '1', '-framerate', String(Math.min(30, fps)), '-i', original.imageFile!]; }); const mattePath = mattePaths.get(clip.id); const presenterInput = needsPresenter && mattePath ? ['-ss', localStart.toFixed(6), '-t', range.duration.toFixed(6), ...inputAcceleration, '-i', mattePath] : [];
        return ['-ss', localStart.toFixed(6), '-t', range.duration.toFixed(6), '-noautorotate', '-display_rotation:v', '0', ...inputAcceleration, '-i', clip.sourcePath, ...brollInputs, ...presenterInput, '-filter_complex', filter, '-map', '[vout]', '-an', '-t', range.duration.toFixed(6), '-fps_mode', 'passthrough', ...encoding.args, ...(outputHdr ? ['-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc'] : bt709ColorArgs()), '-movflags', '+faststart', partOutputPath];
      };
      const audioArgs = (audioOutputPath: string) => timelineAudioArgs(project, sourceSegments, audioOutputPath);
      launchCheckpointExport({ projectId, command: settings.ffmpegBin!, sessionDir, fingerprint, outputPath, encoder: encoding.encoder, ranges, buildPartArgs, audioArgs });
    } catch (error) {
      preparingJob.state = 'failed'; preparingJob.speed = ''; preparingJob.error = error instanceof Error ? error.message : String(error);
    }
  })();
  res.status(202).json({ started: true, outputPath, encoder: encoding.encoder, hardware: encoding.hardware, targetBitRate: encoding.targetBitRate, brollScenes: activeScenes.length, presenterMatte: needsPresenterMatte, checkpoints: ranges.length, clips: projectClips(project).length });
}));

app.post('/api/projects/:id/export', route(async (req, res) => {
  const projectId = routeParam(req.params.id); const project = getProject(projectId); await requireSource(project); const settings = await resolvedSettings(); if (!project.transcript || !project.edl) throw new Error('Missing transcript or edit decision list'); if (!settings.ffmpegBin) throw new Error('FFmpeg was not found'); const active = exportJobs.get(projectId); if (active?.state === 'running') return void res.status(409).json({ error: 'An export is already running for this project' }); const outputPath = await outputFor(req, project, 'cleaned-video.mp4', () => pickExportPath()); if (!outputPath) return void res.status(400).json({ error: 'Export cancelled' });
  const mode: 'fast' | 'quality' = req.body?.mode === 'fast' ? 'fast' : 'quality'; const fps = project.media.frameRate && project.media.frameRate > 0 ? project.media.frameRate : 30; const sourceSegments = splitSegmentsAtClipBoundaries(project, rangesToSeconds(project)); const capabilities = await ffmpegCapabilities(settings.ffmpegBin); const encoding = encodingArgs(project, capabilities, mode); const inputAcceleration = capabilities.videoToolboxDecode ? ['-hwaccel', 'videotoolbox'] : []; const ranges = checkpointRanges(sourceSegments, []); if (!ranges.length) throw new Error('The export timeline is empty'); const fingerprint = await checkpointFingerprint({ project, mode, segments: sourceSegments, encodingArgs: encoding.args, fps }); const checkpointRoot = path.join(project.workDir, 'render-checkpoints'); const sessionDir = path.join(checkpointRoot, fingerprint); await fs.mkdir(checkpointRoot, { recursive: true });
  const sourceMedia = new Map<string, MediaProfile>(); for (const clip of projectClips(project)) sourceMedia.set(clip.id, await probe(clip.sourcePath));
  for (const entry of await fs.readdir(checkpointRoot, { withFileTypes: true })) if (entry.isDirectory() && entry.name !== fingerprint) await fs.rm(path.join(checkpointRoot, entry.name), { recursive: true, force: true }); await fs.mkdir(sessionDir, { recursive: true });
  const buildPartArgs = (range: CheckpointRange, partOutputPath: string) => { const clip = clipForRange(project, range); const localStart = range.start - clip.timelineStart; const media = sourceMedia.get(clip.id) ?? clip.media; const filter = rotationFilter(media.rotation); return ['-ss', localStart.toFixed(6), '-t', range.duration.toFixed(6), '-noautorotate', '-display_rotation:v', '0', ...inputAcceleration, '-i', clip.sourcePath, '-map', '0:v:0', '-an', '-t', range.duration.toFixed(6), ...(filter ? ['-vf', filter] : []), '-fps_mode', 'passthrough', ...encoding.args, ...colorArgs(project), '-movflags', '+faststart', partOutputPath]; };
  launchCheckpointExport({ projectId, command: settings.ffmpegBin, sessionDir, fingerprint, outputPath, encoder: encoding.encoder, ranges, buildPartArgs, audioArgs: (audioOutputPath) => timelineAudioArgs(project, sourceSegments, audioOutputPath) });
  res.status(202).json({ started: true, outputPath, encoder: encoding.encoder, hardware: encoding.hardware, targetBitRate: encoding.targetBitRate, checkpoints: ranges.length, clips: projectClips(project).length });
}));
// ---- One-tap Auto reel: upload -> preview with no further taps (server/auto-reel.ts has the pieces).
const autoJobs = new Map<string, AutoJob>();
type ReviewDecision = { action: 'continue' | 'redo' | 'stop'; keepRanges?: KeepRange[]; notes?: string };
const reviewWaiters = new Map<string, (decision: ReviewDecision) => void>();
const autoJobFile = (project: Project) => path.join(project.workDir, 'auto', 'job.json');
async function persistAutoJob(project: Project, job: AutoJob) {
  const { review, ...rest } = job; // the transcript is large and rebuilt from the project when needed
  await fs.mkdir(path.dirname(autoJobFile(project)), { recursive: true });
  await atomicWriteJson(autoJobFile(project), { ...rest, hadReview: Boolean(review) }).catch(() => undefined);
}
/** What the reel list shows for each reel: state, the step it is on, and the cover once it exists. */
async function reelStatus(project: Project) {
  const job = autoJobs.get(project.id) ?? await fs.readFile(autoJobFile(project), 'utf8').then((text) => JSON.parse(text) as AutoJob).catch(() => null);
  if (!job) return null;
  const current = job.stages?.find((item) => item.state === 'running');
  const interrupted = !autoJobs.has(project.id) && (job.state === 'running' || job.state === 'review');
  return { state: interrupted ? 'failed' : job.state, step: current?.label, queuePosition: job.queuePosition, finishedAt: job.finishedAt, coverUrl: job.package?.thumbnailUrl, previewUrl: job.previewUrl };
}
/** Customers do not see costs. */
function jobView(res: express.Response, job: AutoJob): AutoJob { if (isAdmin(res)) return job; const { cost: _cost, ...rest } = job; return rest; }
async function finishedAtFor(project: Project) {
  const job = autoJobs.get(project.id) ?? await fs.readFile(autoJobFile(project), 'utf8').then((text) => JSON.parse(text) as AutoJob).catch(() => null);
  return job?.state === 'completed' ? job.finishedAt : undefined;
}
async function workspaceReelsThisMonth(workspaceId: string) {
  const owned = [...projects.values()].filter((project) => projectWorkspaceId(project) === workspaceId);
  return reelsThisMonth(await Promise.all(owned.map(finishedAtFor)));
}
async function workspaceCostThisMonth(workspaceId: string) {
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
  const owned = [...projects.values()].filter((project) => projectWorkspaceId(project) === workspaceId);
  const entries = (await Promise.all(owned.map((project) => readUsage(usageFile(project.workDir))))).flat().filter((entry) => Date.parse(entry.at) >= start.getTime());
  return summarizeUsage(entries);
}
const workspaceView = async (workspace: Workspace) => ({ ...workspace, effectiveProfile: (() => { try { return effectiveProfile(workspace); } catch { return null; } })(), reelsThisMonth: await workspaceReelsThisMonth(workspace.id), limitThisMonth: limitThisMonth(workspace), look: packPreview(nichePack(workspace.niche)) });

// ---- Accounts: who am I, and (owner only) the accounts, their engines, logins and monthly use.
app.get('/api/me', route(async (_req, res) => {
  const user = userOf(res); const data = await loadWorkspaces();
  const workspace = user.role === 'member' ? data.workspaces.find((w) => w.id === user.workspaceId) : undefined;
  res.json({ username: user.username, role: user.role, workspace: workspace ? await workspaceView(workspace) : undefined,
    workspaces: user.role === 'admin' ? await Promise.all(data.workspaces.map(workspaceView)) : undefined, allowedProfiles: allowedProfiles() });
}));
const requireAdmin = (res: express.Response) => { if (!isAdmin(res)) throw Object.assign(new Error('Only the owner can do this.'), { status: 403 }); };
// ---- Owner console: everything for the overview, customer pages and reels list in one read.
app.get('/api/admin/console', route(async (_req, res) => {
  requireAdmin(res); await hydrateProjects(); const data = await loadWorkspaces();
  const reels = await Promise.all([...projects.values()].map(async (project) => {
    const job = autoJobs.get(project.id) ?? await fs.readFile(autoJobFile(project), 'utf8').then((text) => JSON.parse(text) as AutoJob).catch(() => null);
    const status = await reelStatus(project);
    const cost = summarizeUsage(await readUsage(usageFile(project.workDir)));
    return { id: project.id, name: project.name, workspaceId: projectWorkspaceId(project), createdAt: project.createdAt, postedAt: project.postedAt,
      state: status?.state ?? 'idle', step: status?.step, error: job?.error, startedAt: job?.startedAt, finishedAt: job?.finishedAt, seconds: job?.finalSeconds,
      coverUrl: status?.coverUrl, previewUrl: status?.previewUrl, cost };
  }));
  const workspaces = await Promise.all(data.workspaces.map(async (workspace) => ({
    ...await workspaceView(workspace), members: data.members.filter((m) => m.workspaceId === workspace.id).map((m) => ({ username: m.username, createdAt: m.createdAt })),
    costThisMonth: await workspaceCostThisMonth(workspace.id),
  })));
  const packs = Object.values(NICHE_PACKS).map((pack) => ({ id: pack.id, ...packPreview(pack), artDirection: pack.artDirection, hashtags: pack.hashtagHints }));
  res.json({ now: Date.now(), packs, workspaces, reels: reels.sort((a, b) => (b.finishedAt ?? b.startedAt ?? 0) - (a.finishedAt ?? a.startedAt ?? 0)), allowedProfiles: allowedProfiles() });
}));
app.post('/api/admin/workspaces/:id/extra-reels', route(async (req, res) => {
  requireAdmin(res); const data = await loadWorkspaces(); const workspace = addExtraReels(data, routeParam(req.params.id), req.body?.reels ?? 5); await saveWorkspaces(data);
  void notify(workspace.id, { title: 'More reels added', body: `You can make ${req.body?.reels ?? 5} more reels this month.`, url: '/#home', tag: `credits-${workspace.id}` });
  res.json(await workspaceView(workspace));
}));
// A gentle phone reminder with this week's first idea (only to that account's logins).
app.post('/api/admin/workspaces/:id/nudge', route(async (req, res) => {
  requireAdmin(res); const workspace = await workspaceFor(routeParam(req.params.id));
  if (workspace.id !== routeParam(req.params.id)) return void res.status(404).json({ error: 'Account not found.' });
  const idea = weeklyIdeas(nichePack(workspace.niche).id, workspace.id)[0];
  const sent = await notify(workspace.id, { title: 'Time for this week\'s reel', body: idea ? `Idea: ${idea.title} · 3 talking points ready` : 'Record a short tip for your patients.', url: idea ? `/#record-${encodeURIComponent(idea.id)}` : '/#home', tag: `nudge-${workspace.id}` });
  res.json({ sent });
}));
// Check the API keys without spending anything: both providers list models for free.
app.post('/api/admin/engines/test', route(async (_req, res) => {
  requireAdmin(res); const settings = await resolvedSettings();
  const check = async (configured: boolean, work: () => Promise<string>) => {
    if (!configured) return { ok: false, detail: 'No key saved' };
    try { return { ok: true, detail: await work() }; } catch (error) { return { ok: false, detail: (error instanceof Error ? error.message : String(error)).replace(/key=[^&\s]+/g, 'key=…').slice(0, 200) }; }
  };
  const [anthropic, gemini] = await Promise.all([
    check(Boolean(settings.anthropicApiKey), async () => {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const model = await new Anthropic({ apiKey: settings.anthropicApiKey }).models.retrieve(settings.apiTextModel);
      return `${model.display_name ?? model.id} is available`;
    }),
    check(Boolean(settings.geminiApiKey), async () => {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.geminiImageModel)}`, { headers: { 'x-goog-api-key': settings.geminiApiKey! } });
      if (!response.ok) throw new Error(`Gemini answered ${response.status}`);
      return `${settings.geminiImageModel} is available`;
    }),
  ]);
  res.json({ anthropic, gemini });
}));
app.get('/api/admin/workspaces', route(async (_req, res) => {
  requireAdmin(res); await hydrateProjects(); const data = await loadWorkspaces();
  res.json({ allowedProfiles: allowedProfiles(), workspaces: await Promise.all(data.workspaces.map(async (workspace) => ({
    ...await workspaceView(workspace), members: data.members.filter((m) => m.workspaceId === workspace.id).map((m) => ({ username: m.username, createdAt: m.createdAt })),
    costThisMonth: await workspaceCostThisMonth(workspace.id),
  }))) });
}));
app.post('/api/admin/workspaces', route(async (req, res) => {
  requireAdmin(res); const data = await loadWorkspaces(); const workspace = createWorkspace(data, req.body ?? {}); await saveWorkspaces(data); res.status(201).json(await workspaceView(workspace));
}));
app.put('/api/admin/workspaces/:workspaceId', route(async (req, res) => {
  requireAdmin(res); const data = await loadWorkspaces(); const workspace = updateWorkspace(data, routeParam(req.params.workspaceId), req.body ?? {}); await saveWorkspaces(data); res.json(await workspaceView(workspace));
}));
app.post('/api/admin/workspaces/:workspaceId/members', route(async (req, res) => {
  requireAdmin(res); const data = await loadWorkspaces();
  const member = await addMember(data, { username: req.body?.username, password: req.body?.password, workspaceId: routeParam(req.params.workspaceId) }, (await loadAuth())?.username);
  await saveWorkspaces(data); res.status(201).json({ username: member.username, workspaceId: member.workspaceId });
}));
app.delete('/api/admin/members/:username', route(async (req, res) => {
  requireAdmin(res); const data = await loadWorkspaces(); removeMember(data, routeParam(req.params.username)); await saveWorkspaces(data); res.json({ ok: true });
}));
// ---- Ideas for the account's field, phone notifications, "posted" marks.
app.get('/api/ideas', route(async (_req, res) => {
  const user = userOf(res); const workspace = await workspaceFor(user.role === 'member' ? user.workspaceId : PERSONAL_WORKSPACE.id);
  const niche = nicheValue(workspace.niche);
  res.json({ niche, label: NICHES.find((n) => n.id === niche)!.label, week: weeklyIdeas(niche, workspace.id), all: IDEAS[niche] });
}));
app.get('/api/push/key', route(async (_req, res) => { res.json({ publicKey: (await vapidKeys()).publicKey }); }));
app.post('/api/push/subscribe', route(async (req, res) => {
  const user = userOf(res); await addSubscriber({ username: user.username, role: user.role, workspaceId: user.workspaceId, subscription: req.body?.subscription }); res.json({ ok: true });
}));
app.post('/api/push/unsubscribe', route(async (req, res) => { await removeSubscriber(String(req.body?.endpoint ?? '')); res.json({ ok: true }); }));
app.post('/api/projects/:id/posted', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); project.postedAt = req.body?.posted === false ? undefined : new Date().toISOString();
  await saveProject(project, false); res.json({ postedAt: project.postedAt ?? null });
}));
app.get('/api/projects/:id/usage', route(async (req, res) => {
  requireAdmin(res); const project = getProject(routeParam(req.params.id)); const entries = await readUsage(usageFile(project.workDir));
  res.json({ summary: summarizeUsage(entries), entries });
}));

/** One render at a time on this machine (4 cores); the rest wait in order and see their place in line. */
class RenderQueue {
  private busy = false; private waiting: Array<{ go: () => void; onPosition: (ahead: number) => void }> = [];
  async acquire(onPosition: (ahead: number) => void, stopped: () => boolean): Promise<() => void> {
    if (this.busy) {
      await new Promise<void>((resolve, reject) => {
        const entry = { go: resolve, onPosition }; this.waiting.push(entry); this.update();
        const timer = setInterval(() => { if (stopped()) { clearInterval(timer); this.waiting = this.waiting.filter((w) => w !== entry); this.update(); reject(new Error('Stopped')); } }, 1000);
        entry.go = () => { clearInterval(timer); resolve(); };
      });
    }
    this.busy = true; onPosition(0);
    let released = false;
    return () => { if (released) return; released = true; this.busy = false; const next = this.waiting.shift(); this.update(); next?.go(); };
  }
  private update() { this.waiting.forEach((entry, index) => entry.onPosition(index + 1)); }
}
const renderQueue = new RenderQueue();

/** Run (or resume) a reel in its account's context, and tell the phone how it ended. */
function startAutoRun(project: Project, job: AutoJob, context: Awaited<ReturnType<typeof projectUsageContext>>) {
  autoJobs.set(project.id, job);
  void runWithUsage(context, () => runAutoReel(project, job)).then(() => { job.state = 'completed'; }).catch((error) => { job.state = job.stopRequested ? 'stopped' : 'failed'; job.error = error instanceof Error ? error.message : String(error); })
    .finally(async () => {
      job.finishedAt = Date.now(); job.queuePosition = undefined; job.cost = await reelCost(project).catch(() => undefined); void persistAutoJob(project, job);
      const workspaceId = projectWorkspaceId(project); const url = `/#reel-${project.id}`;
      if (job.state === 'completed') void notify(workspaceId, { title: 'Your reel is ready', body: `${project.name}: save it and post.`, url, tag: `reel-${project.id}` });
      else if (job.state === 'failed') void notify(workspaceId, { title: 'Your reel stopped', body: `${project.name}: tap to see what happened. No reel was used.`, url, tag: `reel-${project.id}` }, true);
    });
}
const previewPathFor = (output: string) => output.replace(/-auto-reel\.mp4$/, '-preview.mp4');
/** Small 720p copy for watching on the phone; the full file stays for saving. */
async function addPhonePreview(project: Project, job: AutoJob, ffmpegBin: string) {
  if (!job.outputPath || !/-auto-reel\.mp4$/.test(job.outputPath)) return;
  const preview = previewPathFor(job.outputPath);
  if (!(await fs.stat(preview).catch(() => null))?.size) await makePreviewVideo(ffmpegBin, job.outputPath, `${preview}.part.mp4`).then(() => fs.rename(`${preview}.part.mp4`, preview));
  const url = downloadUrlFor(project, preview); if (url) job.previewUrl = `${url}?inline=1`;
}
/** Older finished reels: make their phone previews one at a time in the background. */
async function backfillPhonePreviews() {
  const settings = await resolvedSettings(); if (!settings.ffmpegBin) return;
  for (const project of projects.values()) {
    const job = await loadAutoJob(project).catch(() => null);
    if (!job || job.state !== 'completed' || !job.outputPath || job.previewUrl?.includes('-preview.mp4')) continue;
    if (!(await fs.stat(job.outputPath).catch(() => null))) continue;
    try { await addPhonePreview(project, job, settings.ffmpegBin); await persistAutoJob(project, job); console.log(`Phone preview made for ${project.id}`); }
    catch (error) { console.error(`Preview for ${project.id} failed:`, error); }
  }
}
/** After a restart: carry on with reels that were mid-way (finished steps are not redone). */
async function resumeAutoJobs() {
  for (const project of projects.values()) {
    const saved = await fs.readFile(autoJobFile(project), 'utf8').then((text) => JSON.parse(text) as AutoJob & { hadReview?: boolean }).catch(() => null);
    if (!saved || (saved.state !== 'running' && saved.state !== 'review') || saved.stopRequested) continue;
    for (const item of saved.stages) if (item.state === 'running' || item.state === 'failed') { item.state = 'pending'; item.detail = undefined; }
    saved.state = 'running'; saved.resumed = true; saved.error = undefined;
    try { startAutoRun(project, saved, await projectUsageContext(project)); console.log(`Resumed reel ${project.id} (${project.name})`); }
    catch (error) { console.error(`Could not resume ${project.id}:`, error); }
  }
}

const RENDER_STAGES = new Set<AutoStageId>(['edit', 'captions', 'compose']);
async function reelCost(project: Project) { return summarizeUsage(await readUsage(usageFile(project.workDir))); }
async function runAutoReel(project: Project, job: AutoJob) {
  const settings = await resolvedSettings();
  if (!settings.ffmpegBin) throw new Error('FFmpeg was not found');
  const python = await resolvePythonBin(); if (!python) throw new Error('Python 3 was not found');
  const dir = path.join(project.workDir, 'auto'); await fs.mkdir(dir, { recursive: true });
  const portrait = (project.media.height || 1920) >= (project.media.width || 1080);
  const [W, H] = portrait ? [1080, 1920] : [1920, 1080];
  const pack = await projectPack(project);
  // restore: how to get a finished stage's result back when a reel resumes after a restart.
  const stage = async <T>(id: AutoStageId, work: (note: (detail: string) => void) => Promise<T>, restore?: () => Promise<T>): Promise<T | undefined> => {
    const item = job.stages.find((s) => s.id === id)!; if (item.state === 'skipped') return undefined;
    if (item.state === 'done') return restore ? restore() : undefined;
    if (job.stopRequested) throw new Error('Stopped');
    // This machine renders one reel at a time; others wait in line.
    const release = RENDER_STAGES.has(id) ? await renderQueue.acquire((ahead) => { job.queuePosition = ahead || undefined; item.detail = ahead ? `Waiting for ${ahead} reel${ahead === 1 ? '' : 's'} ahead to finish…` : undefined; void persistAutoJob(project, job); }, () => Boolean(job.stopRequested)) : () => undefined;
    item.state = 'running'; const started = Date.now(); void persistAutoJob(project, job);
    try {
      const result = await withTask(id, () => work((detail) => { item.detail = detail; })).finally(release);
      item.state = 'done'; item.seconds = Math.round((Date.now() - started) / 1000);
      if (RENDER_STAGES.has(id)) await withTask(id, () => recordUsage({ kind: 'render', provider: 'this computer', renderSeconds: (Date.now() - started) / 1000 }));
      void persistAutoJob(project, job); return result;
    }
    catch (error) { item.state = 'failed'; item.detail = error instanceof Error ? error.message : String(error); void persistAutoJob(project, job); throw error; }
  };
  await stage('audio', async (note) => { await ensureAnalysisAudio(project); note(`${Math.round(project.media.duration)} s of audio`); });
  await stage('transcribe', async (note) => { const t = await transcribeProject(project); note(`${t.words.length} words`); });
  await stage('clean', async (note) => { const r = await cleanProject(project, 'aggressive', job.options.targetDurationSec); job.sourceSeconds = r.sourceSeconds; note(`${r.sourceSeconds} s → ${r.keptSeconds} s`); });
  const words = project.transcript!.words;
  await stage('review', async (note) => {
    // Pause: show the cleaned transcript; the owner keeps/removes sentences or writes notes for the AI.
    for (;;) {
      const keepRanges = project.edl!.keepRanges;
      job.review = { words: words.map(({ id, text, start, end }) => ({ id, text, start, end })), keepRanges, keptSeconds: Math.round(keptDuration(words, keepRanges) * 10) / 10, sourceSeconds: Math.round((words.at(-1)!.end - words[0].start) * 10) / 10 };
      job.review.flags = findClaims(job.review.words, pack.risky);
      job.state = 'review'; note('Waiting for you to check the transcript'); void persistAutoJob(project, job);
      void notify(projectWorkspaceId(project), { title: 'Your turn: check the talk', body: `${project.name}: see what stays before the reel is made.`, url: `/#reel-${project.id}`, tag: `reel-${project.id}` });
      const decision = await new Promise<ReviewDecision>((resolve) => reviewWaiters.set(project.id, resolve));
      reviewWaiters.delete(project.id); job.state = 'running';
      if (decision.action === 'stop') { job.review = undefined; throw new Error('Stopped'); }
      if (decision.action === 'redo') {
        job.review = { ...job.review, notes: decision.notes, redoing: true }; note('Re-cleaning with your notes…');
        await cleanProject(project, 'aggressive', job.options.targetDurationSec, { notes: decision.notes ?? '', previous: keepRanges });
        continue;
      }
      if (decision.keepRanges) {
        project.edl = { ...validateEdl(words, { keepRanges: decision.keepRanges, notes: project.edl!.notes }) };
        await invalidateBroll(project); await Promise.all([atomicWriteJson(path.join(project.workDir, 'edl.json'), project.edl), touchProject(project)]);
      }
      note(`Approved · ${Math.round(keptDuration(words, project.edl!.keepRanges))} s kept`); job.review = undefined; return;
    }
  });
  let plan: BrollPlan | undefined;
  await stage('broll-plan', async (note) => {
    plan = await createBrollPlan({ textConfig: settings, workDir: project.workDir, words, keepRanges: project.edl?.keepRanges, orientation: portrait ? 'portrait' : 'landscape',
      settings: { workflowMode: 'cleaned-video', provider: job.options.imageProvider === 'chatgpt' ? 'chatgpt-browser' : 'gemini', planningProvider: textEngines(settings).planning.provider, planningModel: textEngines(settings).planning.model, planningEffort: textEngines(settings).planning.effort,
        artDirection: pack.artDirection, countMode: 'per-minute', imagesPerMinute: 6, minSceneDuration: 2, maxSceneDuration: 4, aspectRatio: portrait ? '9:16' : '16:9' } });
    brollPlans.set(project.id, plan); note(`${plan.scenes.length} moments`);
  }, async () => { plan = await loadBrollPlan(project.workDir) ?? undefined; if (plan) brollPlans.set(project.id, plan); });
  await stage('broll-images', async (note) => {
    if (!plan) return;
    const config = { openAiApiKey: settings.openAiApiKey, openAiModel: settings.openAiImageModel, geminiApiKey: settings.geminiApiKey, geminiModel: settings.geminiImageModel, grokBin: settings.grokBin, grokModel: settings.grokModel, grokVideoModel: settings.grokVideoModel, codexBin: settings.codexBin, codexModel: settings.codexModel, claudeBin: settings.claudeBin, ffmpegBin: settings.ffmpegBin, picturesEngine: picturesEngine(settings) };
    if (job.options.imageProvider === 'chatgpt') {
      note(`ChatGPT in Chrome · ${plan.scenes.length} pictures in one chat…`);
      // A failed picture step should not throw away the whole reel: keep going without B-roll and say why.
      const made = await generateBrollImagesWithChatGpt({ config, workDir: project.workDir, plan, sceneIds: plan.scenes.filter((scene) => scene.imageStatus !== 'ready').map((scene) => scene.id), onLine: (text) => note(text) })
        .catch((error) => { note(`ChatGPT pictures failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 400)); return null; });
      if (!made) { brollPlans.set(project.id, plan); return; }
      brollPlans.set(project.id, plan); note(`${made.length} / ${plan.scenes.length} from ChatGPT`); return;
    }
    // After a restart, pictures that were already made are kept.
    let done = plan.scenes.filter((scene) => scene.imageStatus === 'ready').length; let failed = 0; const queue = plan.scenes.filter((scene) => scene.imageStatus !== 'ready');
    const workers = 3; // Gemini images in parallel (ChatGPT returned above)
    note(`0 / ${queue.length}`);
    await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, async () => {
      for (let scene = queue.shift(); scene; scene = queue.shift()) {
        if (job.stopRequested) return;
        try { await generateBrollImage({ workDir: project.workDir, plan: plan!, sceneId: scene.id, config }); done += 1; } catch { failed += 1; }
        note(`${done} / ${plan!.scenes.length}${failed ? ` · ${failed} failed (skipped)` : ''}`);
      }
    }));
    brollPlans.set(project.id, plan);
  });
  const edited = await stage('edit', async (note) => {
    await fs.writeFile(path.join(dir, 'words.json'), JSON.stringify({ words }));
    await fs.writeFile(path.join(dir, 'keep.json'), JSON.stringify({ keep: keepIndexRanges(words, project.edl!.keepRanges) }));
    // Every clip with its place on the project timeline, its own analysis audio and its own colour conversion.
    const clips = syncProjectTimeline(project).map((clip) => ({ path: clip.sourcePath, start: clip.timelineStart, end: clip.timelineEnd, audio: clip.audioPath ?? '', color: colorVideoFilter(clip.media, false) }));
    await fs.writeFile(path.join(dir, 'clips.json'), JSON.stringify(clips));
    note(clips.length > 1 ? `Cutting and grading shots from ${clips.length} clips…` : 'Cutting and grading shots…');
    const result = await runPython(python, AUTO_EDIT_SCRIPT, [path.join(dir, 'clips.json'), path.join(dir, 'words.json'), path.join(dir, 'keep.json'), dir, String(W), String(H), '-', '1.07']);
    job.finalSeconds = result.duration; note(`${result.clips > 1 ? `${result.clips} clips · ` : ''}${result.cuts} cuts · ${result.shots} shots · ${Math.round(result.duration)} s`);
    return result as { duration: number };
  }, async () => ({ duration: job.finalSeconds! }));
  const duration = edited!.duration;
  await run(settings.ffmpegBin, ['-hide_banner', '-v', 'error', '-y', '-i', path.join(dir, 'video.mp4'), '-i', path.join(dir, 'speech-master.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', path.join(dir, 'base.mp4')]);
  const captionFile = path.join(dir, 'captions-glass.txt'); // timed list of caption images (see renderCaptionLayer)
  const captioned = await stage('captions', async (note) => {
    const editedWords = JSON.parse(await fs.readFile(path.join(dir, 'edited-words.json'), 'utf8')).words as CaptionWordIn[];
    const phrases = buildCaptionPhrases(editedWords, duration);
    await renderCaptionLayer({ look: packLook(pack), phrases, duration, outputPath: captionFile, chromeBin: await detectChromeBin(), workDir: dir, onProgress: (f) => note(`${Math.round(f * 100)}%`) });
    note(`${phrases.length} phrases`); return true;
  }, async () => fs.stat(captionFile).then(() => true, () => undefined));
  await stage('compose', async (note) => {
    const editRanges = JSON.parse(await fs.readFile(path.join(dir, 'edit.json'), 'utf8')).ranges as EditRange[];
    const scenes = (plan?.scenes ?? []).map((scene) => ({ id: scene.id, startWordId: scene.startWordId, sourceStart: scene.sourceStart, sourceEnd: scene.sourceEnd, image: scene.imageStatus === 'ready' ? scene.imageFile : undefined }));
    const broll = job.options.broll ? placeBroll(words, editRanges, scenes, duration) : [];
    await fs.writeFile(path.join(dir, 'broll-placed.json'), JSON.stringify({ scenes: broll }));
    await fs.mkdir(exportsDir(project), { recursive: true });
    const output = path.join(exportsDir(project), `${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-auto-reel.mp4`);
    note(`${broll.length} B-roll cutaways…`);
    await runPython(python, AUTO_COMPOSITE_SCRIPT, [path.join(dir, 'base.mp4'), path.join(dir, 'broll-placed.json'), path.join(dir, 'broll-clips'), captioned ? captionFile : '-', String(Math.round(H * 0.651)), WHOOSH, output, String(W), String(H), previewPathFor(output)]); // phone preview made in the same pass
    job.outputPath = output; job.downloadUrl = downloadUrlFor(project, output); job.previewUrl = job.downloadUrl ? `${job.downloadUrl}?inline=1` : undefined;
    note('Making a phone preview…');
    await addPhonePreview(project, job, settings.ffmpegBin!).catch((error) => console.error(`Preview for ${project.id} failed:`, error));
    note(`${broll.length} B-roll · captions ${captioned ? 'on' : 'off'}`);
  });
  // The reel is done; a failed thumbnail/caption must not throw it away (it can be remade from the reel screen).
  await stage('package', async (note) => {
    note('Picking a cover frame and writing the caption…');
    await makeReelPackage(project, job);
    note(job.options.thumbnail === false ? 'Post caption ready' : 'Thumbnail and post caption ready');
  }).catch((error) => { if (job.stopRequested) throw error; });
}

const thumbDir = (project: Project) => path.join(project.workDir, 'auto', 'thumb');
const frameUrl = (project: Project, n: number) => `/api/projects/${project.id}/auto/frames/${n}?v=${Date.now()}`;
/** Frames + AI text (cover lines, label, badges, post caption, hashtags), then the cover image. */
async function makeReelPackage(project: Project, job: AutoJob, notes?: string) {
  const settings = await resolvedSettings();
  if (!settings.ffmpegBin) throw new Error('FFmpeg was not found');
  const dir = path.join(project.workDir, 'auto');
  const edited = JSON.parse(await fs.readFile(path.join(dir, 'edited-words.json'), 'utf8')) as { words: Array<{ text: string }>; duration: number };
  job.package = { frames: [], frame: 0, lines: ['', '', ''], label: '', badges: [], caption: '', hashtags: [], ...job.package, state: 'running', error: undefined };
  void persistAutoJob(project, job);
  try {
    const smalls = await extractCandidateFrames(settings.ffmpegBin, path.join(dir, 'video.mp4'), edited.duration, thumbDir(project));
    const choice = textEngines(settings).planning;
    const raw = await generateStructuredText({ choice, config: settings, workDir: project.workDir, prompt: buildPackagePrompt(edited.words.map((word) => word.text).join(' '), smalls, notes, packWriterNotes(await projectPack(project))), schema: PACKAGE_SCHEMA as unknown as Record<string, unknown>, outputName: 'reel-package', images: smalls });
    Object.assign(job.package, cleanPackage(raw), { frames: smalls.map((_, n) => frameUrl(project, n)) });
    if (job.options.thumbnail !== false) await renderPackageThumbnail(project, job.package);
    job.package.state = 'ready';
  } catch (error) {
    job.package.state = 'failed'; job.package.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally { void persistAutoJob(project, job); }
}
async function renderPackageThumbnail(project: Project, pkg: ReelPackage) {
  await fs.mkdir(exportsDir(project), { recursive: true });
  const output = path.join(exportsDir(project), `${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-thumbnail.jpg`);
  await renderThumbnail({ look: packLook(await projectPack(project)), framePath: framePaths(thumbDir(project), pkg.frame).full, faceX: pkg.faces?.[pkg.frame], lines: pkg.lines, label: pkg.label, badges: pkg.badges, outputPath: output, chromeBin: await detectChromeBin(), workDir: project.workDir });
  if (pkg.thumbnailPath && pkg.thumbnailPath !== output) await fs.rm(pkg.thumbnailPath, { force: true }).catch(() => undefined);
  pkg.thumbnailPath = output; pkg.thumbnailDownloadUrl = downloadUrlFor(project, output);
  pkg.thumbnailUrl = pkg.thumbnailDownloadUrl ? `${pkg.thumbnailDownloadUrl}?inline=1` : undefined;
}
/** The live job, or the finished one saved on disk (after a restart). */
async function loadAutoJob(project: Project) {
  const live = autoJobs.get(project.id); if (live) return live;
  const saved = await fs.readFile(autoJobFile(project), 'utf8').then((text) => JSON.parse(text) as AutoJob).catch(() => null);
  if (!saved || saved.state === 'running' || saved.state === 'review') return null;
  if (saved.package?.state === 'running') { saved.package.state = 'failed'; saved.package.error = 'Interrupted by a restart of the app.'; }
  autoJobs.set(project.id, saved); return saved;
}
// ---- Stick studio ("write it for me"): settings, AI script, AI narration. Owner login only.
const studioRoute = (handler: (req: express.Request, res: express.Response) => Promise<void>) =>
  route(async (req, res) => {
    if (!isAdmin(res)) return void res.status(403).json({ error: 'Stick-figure reels are for the owner login only.' });
    await handler(req, res);
  });
const studioDir = () => path.join(CONFIG_DIR, 'stick-studio');
const scriptFromBody = (value: unknown): StickScript | undefined => {
  const input = value as { title?: unknown; lines?: unknown } | undefined;
  if (!input || !Array.isArray(input.lines)) return undefined;
  const lines = input.lines.map((line) => String(line ?? '').trim()).filter(Boolean).slice(0, 30).map((line) => line.slice(0, 300));
  return lines.length ? { title: String(input.title ?? '').slice(0, 80), lines } : undefined;
};
app.get('/api/stick/studio', studioRoute(async (_req, res) => {
  const settings = await resolvedSettings(); const script = textEngines(settings).script;
  res.json({
    settings: await loadStudioSettings(), voices: MALE_VOICES, themes: STICK_THEMES, facePacks: await listStickFacePacks(),
    scriptEngine: { provider: script.provider, model: script.model || 'default', effort: script.effort || 'default' }, geminiReady: Boolean(settings.geminiApiKey),
  });
}));
app.put('/api/stick/studio', studioRoute(async (req, res) => { res.json({ settings: await saveStudioSettings(req.body ?? {}) }); }));
type ScriptJob = { id: string; state: 'running' | 'ready' | 'failed'; script?: StickScript; error?: string; startedAt: number };
const scriptJobs = new Map<string, ScriptJob>();
app.get('/api/stick/script/:jobId', studioRoute(async (req, res) => {
  const job = scriptJobs.get(routeParam(req.params.jobId));
  if (!job) return void res.status(404).json({ error: 'That script job is gone (the app restarted). Write it again.' });
  res.json({ job });
}));
app.post('/api/stick/script', studioRoute(async (req, res) => {
  const settings = await resolvedSettings(); const studio = await loadStudioSettings();
  for (const [key, old] of scriptJobs) if (Date.now() - old.startedAt > 6 * 3600_000) scriptJobs.delete(key);
  const job: ScriptJob = { id: randomUUID(), state: 'running', startedAt: Date.now() }; scriptJobs.set(job.id, job);
  const concept = typeof req.body?.concept === 'string' ? req.body.concept.slice(0, 3000) : '';
  const script = writeStickScript({
    concept, seconds: Number(req.body?.seconds) || undefined,
    feedback: typeof req.body?.feedback === 'string' ? req.body.feedback.slice(0, 1500) : undefined,
    previous: scriptFromBody(req.body?.previous),
    settings: studio, textConfig: settings, choice: textEngines(settings).script, workDir: path.join(studioDir(), 'work'),
  });
  res.status(202).json({ job });
  void script.then((value) => Object.assign(job, { state: 'ready', script: value }), (error) => Object.assign(job, { state: 'failed', error: error instanceof Error ? error.message : String(error) }));
}));
app.post('/api/stick/voice-preview', studioRoute(async (req, res) => {
  const settings = await resolvedSettings(); const studio = { ...await loadStudioSettings(), ...(typeof req.body?.voice === 'string' && /^[A-Za-z]{2,30}$/.test(req.body.voice) ? { voice: req.body.voice } : {}), ...(typeof req.body?.voiceStyle === 'string' && req.body.voiceStyle.trim() ? { voiceStyle: req.body.voiceStyle.trim().slice(0, 1200) } : {}) };
  const id = randomUUID(); const file = path.join(studioDir(), 'previews', `${id}.wav`);
  await previewVoice({ settings: studio, apiKey: settings.geminiApiKey, line: typeof req.body?.line === 'string' ? req.body.line : undefined, outWav: file });
  res.json({ url: `/api/stick/voice-preview/${id}.wav` });
}));
app.get('/api/stick/voice-preview/:file', studioRoute(async (req, res) => {
  const name = routeParam(req.params.file); if (!/^[0-9a-f-]{36}\.wav$/.test(name)) return void res.status(404).end();
  res.sendFile(path.join(studioDir(), 'previews', name));
}));
app.post('/api/stick/narrate', studioRoute(async (req, res) => {
  const script = scriptFromBody(req.body?.script); if (!script) throw new Error('Approve a script first.');
  if ([...narrationJobs.values()].some((job) => job.state === 'running')) return void res.status(409).json({ error: 'A voice is already being made. Wait for it to finish.' });
  const settings = await resolvedSettings(); const studio = await loadStudioSettings();
  if (!settings.ffmpegBin) throw new Error('FFmpeg was not found.');
  const ffmpegBin = settings.ffmpegBin;
  const job = newNarrationJob();
  res.status(202).json({ job });
  void (async () => {
    const work = path.join(studioDir(), 'narration', job.id);
    try {
      const wav = path.join(work, 'voice.wav');
      job.stage = `Recording line 1 of ${script.lines.length}…`;
      await narrateScript({ lines: script.lines, settings: studio, apiKey: settings.geminiApiKey, outWav: wav, progress: (done, total) => { job.progress = done / total * 0.9; job.stage = done < total ? `Recording line ${done + 1} of ${total}…` : 'Finishing the voice…'; } });
      const slug = (script.title || 'ai-voice').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ai-voice';
      const m4a = path.join(work, `${slug}.m4a`);
      const tempo = Math.abs(studio.speed - 1) > 0.005 ? ['-af', `atempo=${studio.speed.toFixed(3)}`] : [];
      await run(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, ...tempo, '-ar', '48000', '-c:a', 'aac', '-b:a', '160k', m4a], undefined, 120_000);
      await fs.writeFile(path.join(work, 'script.json'), JSON.stringify(script, null, 2));
      const size = (await fs.stat(m4a)).size;
      const meta = await createUpload(await uploadsDir(), { name: `${slug}.m4a`, size });
      await fs.copyFile(m4a, meta.file);
      const probed = await probe(m4a).catch(() => null);
      Object.assign(job, { state: 'ready', progress: 1, stage: 'Voice ready', uploadId: meta.id, seconds: probed?.duration ?? undefined });
      await fs.rm(wav, { force: true }).catch(() => undefined);
    } catch (error) {
      Object.assign(job, { state: 'failed', progress: 0, stage: 'Failed', error: error instanceof Error ? error.message : String(error) });
    }
  })();
}));
app.get('/api/stick/narrate/:jobId', studioRoute(async (req, res) => {
  const job = narrationJobs.get(routeParam(req.params.jobId));
  if (!job) return void res.status(404).json({ error: 'That voice job is gone (the app restarted). Make the voice again.' });
  res.json({ job, url: job.uploadId ? `/api/stick/narrate/${job.id}/audio` : undefined });
}));
app.get('/api/stick/narrate/:jobId/audio', studioRoute(async (req, res) => {
  const job = narrationJobs.get(routeParam(req.params.jobId));
  if (!job?.uploadId) return void res.status(404).end();
  res.setHeader('Accept-Ranges', 'bytes'); res.sendFile((await readUpload(await uploadsDir(), job.uploadId)).file);
}));

const stickJobs = new Map<string, StickRender>();
const stickRoute = (handler: (req: express.Request, res: express.Response, project: Project) => Promise<void>) =>
  route(async (req, res) => {
    if (!isAdmin(res)) return void res.status(403).json({ error: 'Stick-figure reels are for the owner login only.' });
    const project = getProject(routeParam(req.params.id));
    if (projectClips(project).length !== 1 || !Number.isFinite(project.media.duration) || project.media.duration <= 0 || project.media.duration > 300) {
      throw new Error('Use one recording, up to five minutes long.');
    }
    await handler(req, res, project);
  });

app.get('/api/projects/:id/stick', stickRoute(async (_req, res, project) => {
  const saved = await fs.readFile(path.join(project.workDir, 'stick-render.json'), 'utf8')
    .then(text => JSON.parse(text) as StickRender).catch(() => null);
  const render = stickJobs.get(project.id) ?? (saved?.state === 'running' ? { state: 'failed' as const, progress: 0, error: 'Interrupted by a server restart.' } : saved);
  res.json({
    draft: await loadStickDraft(project),
    render,
    duration: project.media.duration,
    audioUrl: `/api/projects/${project.id}/stick/audio`,
    customMusic: await fs.access(stickMusicPath(project)).then(() => true, () => false),
    facePacks: await listStickFacePacks(),
    themes: STICK_THEMES,
    plan: stickPlans.get(project.id) ?? null,
  });
}));
app.get('/api/projects/:id/stick/audio', stickRoute(async (_req, res, project) => {
  await requireSource(project);
  res.setHeader('Accept-Ranges', 'bytes');
  res.sendFile(project.sourcePath);
}));
app.put('/api/projects/:id/stick', stickRoute(async (req, res, project) => {
  res.json({ draft: await saveStickDraft(project, req.body) });
}));
app.put('/api/projects/:id/stick/music', stickRoute(async (req, res, project) => {
  const settings = await resolvedSettings();
  if (!settings.ffmpegBin) throw new Error('FFmpeg was not found.');
  const source = await completedUploadPath(await uploadsDir(), String(req.body?.uploadId ?? ''), 'audio');
  const temporary = path.join(project.workDir, `music-${randomUUID()}.m4a`);
  try {
    await run(settings.ffmpegBin, ['-v', 'error', '-i', source, '-map', '0:a:0', '-t', '300', '-c:a', 'aac', '-b:a', '192k', temporary], undefined, 120_000);
    await fs.rename(temporary, stickMusicPath(project));
  } finally { await fs.rm(temporary, { force: true }); }
  res.json({ customMusic: true });
}));
app.delete('/api/projects/:id/stick/music', stickRoute(async (_req, res, project) => {
  await fs.rm(stickMusicPath(project), { force: true });
  res.json({ customMusic: false });
}));
app.post('/api/projects/:id/stick/transcribe', stickRoute(async (_req, res, project) => {
  const context = await projectUsageContext(project);
  const transcript = await runWithUsage(context, () => transcribeProject(project));
  const existing = await loadStickDraft(project);
  const next = makeStickDraft(transcript.words.filter(word => word.start < project.media.duration));
  next.themeId = existing.themeId;
  next.faces = existing.faces;
  next.music = existing.music;
  next.sfx = existing.sfx;
  next.useOpenverse = existing.useOpenverse;
  res.json({ draft: await saveStickDraft(project, next) });
}));
/** Planning can take minutes (longer than Cloudflare's ~100 s request limit), so it runs in the background; GET .../stick reports it. */
const stickPlans = new Map<string, { state: 'running' | 'failed'; error?: string }>();
app.post('/api/projects/:id/stick/plan', stickRoute(async (req, res, project) => {
  if (stickPlans.get(project.id)?.state === 'running') return void res.status(202).json({ plan: stickPlans.get(project.id) });
  const plan = { state: 'running' as 'running' | 'failed', error: undefined as string | undefined }; stickPlans.set(project.id, plan);
  res.status(202).json({ plan });
  void planStickInBackground(req, project).then(() => { stickPlans.delete(project.id); }, (error) => { plan.state = 'failed'; plan.error = error instanceof Error ? error.message : String(error); });
}));
async function planStickInBackground(req: express.Request, project: Project) {
  const context = await projectUsageContext(project);
  const settings = await resolvedSettings();
  const existing = await loadStickDraft(project);
  let words = existing.words;
  if (!words.length) {
    const transcript = await runWithUsage(context, () => transcribeProject(project));
    words = transcript.words.filter(word => word.start < project.media.duration);
  }
  const brief = typeof req.body?.brief === 'string' ? req.body.brief.trim().slice(0, 1200) : undefined;
  const themeId = typeof req.body?.themeId === 'string' ? req.body.themeId.trim() : undefined;
  const planned = await runWithUsage(context, () => planStickReelWithAi({
    textConfig: settings,
    choice: textEngines(settings).planning,
    workDir: project.workDir,
    words,
    duration: project.media.duration,
    existing,
    brief,
    themeId,
  }));
  await saveStickDraft(project, planned);
}
app.post('/api/projects/:id/stick/render', stickRoute(async (req, res, project) => {
  if ([...stickJobs.values()].some(job => job.state === 'running')) {
    return void res.status(409).json({ error: 'A stick-figure reel is already rendering.' });
  }
  const job: StickRender = { state: 'running', progress: 0, stage: 'Preparing render…' };
  stickJobs.set(project.id, job);
  try {
    await requireSource(project);
    const draft = req.body?.scenes ? await saveStickDraft(project, req.body) : await loadStickDraft(project);
    const settings = await resolvedSettings();
    if (!settings.ffmpegBin) throw new Error('FFmpeg was not found.');
    const ffmpegBin = settings.ffmpegBin;
    const renderId = randomUUID();
    const temporary = path.join(project.workDir, `stick-${renderId}-visual.mp4`);
    const output = path.join(exportsDir(project), `stick-reel-${renderId}.mp4`);
    const creditsPath = path.join(exportsDir(project), `stick-reel-${renderId}-credits.txt`);
    await fs.mkdir(exportsDir(project), { recursive: true });
    res.status(202).json({ render: job });
    void (async () => {
      try {
        const result = await renderStickReel({
          project, draft, visual: temporary, output, creditsPath, chromeBin: await detectChromeBin(),
          ffmpeg: args => run(ffmpegBin, args, undefined, 600_000),
          progress: (value, stage) => { job.progress = value; if (stage) job.stage = stage; },
        });
        const finished: StickRender = {
          state: 'ready', progress: 1, stage: 'Ready',
          url: downloadUrlFor(project, output),
          ...(result.wroteCredits ? { creditsUrl: downloadUrlFor(project, creditsPath) } : {}),
        };
        await atomicWriteJson(path.join(project.workDir, 'stick-render.json'), finished);
        Object.assign(job, finished);
      } catch (error) {
        const failed: StickRender = { state: 'failed', progress: 0, error: error instanceof Error ? error.message : String(error) };
        await atomicWriteJson(path.join(project.workDir, 'stick-render.json'), failed).catch(() => undefined);
        Object.assign(job, failed);
        await fs.rm(output, { force: true }).catch(() => undefined);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
      }
    })();
  } catch (error) {
    stickJobs.delete(project.id);
    throw error;
  }
}));

app.post('/api/projects/:id/auto', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id));
  if (['running', 'review'].includes(autoJobs.get(project.id)?.state ?? '')) return void res.status(409).json({ error: 'Auto reel is already running for this project' });
  const workspace = await workspaceFor(project.workspaceId); const context = await projectUsageContext(project);
  const limit = limitThisMonth(workspace);
  if (limit) {
    const used = await workspaceReelsThisMonth(workspace.id);
    if (used >= limit) return void res.status(409).json({ error: `You have made all ${limit} reels for this month. New reels open on the 1st.` });
  }
  const options: AutoOptions = {
    // API accounts make pictures with the Gemini API; ChatGPT in Chrome runs on this computer's subscription.
    targetDurationSec: targetDurationValue(req.body?.targetDurationSec), imageProvider: req.body?.imageProvider === 'chatgpt' && context.profile === 'in-house' ? 'chatgpt' : 'gemini',
    broll: req.body?.broll !== false, captions: req.body?.captions !== false, review: req.body?.review !== false,
    thumbnail: req.body?.thumbnail !== false, postCaption: req.body?.postCaption !== false,
  };
  const job = newAutoJob(options); job.profile = context.profile;
  startAutoRun(project, job, context);
  res.status(202).json(jobView(res, job));
}));
app.get('/api/projects/:id/auto', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const live = autoJobs.get(project.id);
  const look = packPreview(await projectPack(project));
  if (live) { if (isAdmin(res)) live.cost = await reelCost(project); return void res.json({ ...jobView(res, live), look }); }
  // After a restart the job is read back from disk; one that was mid-way cannot continue.
  const saved = await fs.readFile(autoJobFile(project), 'utf8').then((text) => JSON.parse(text) as AutoJob).catch(() => null);
  if (!saved) return void res.json({ state: 'idle' });
  if (saved.state === 'running' || saved.state === 'review') { saved.state = 'failed'; saved.error = 'Interrupted by a restart of the app. Start the reel again.'; }
  if (isAdmin(res)) saved.cost = await reelCost(project);
  res.json({ ...jobView(res, saved), look });
}));
app.post('/api/projects/:id/auto/review', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const job = autoJobs.get(project.id); const resolve = reviewWaiters.get(project.id);
  if (!job || job.state !== 'review' || !resolve) return void res.status(409).json({ error: 'This reel is not waiting for a review.' });
  const action = req.body?.action === 'redo' ? 'redo' : 'continue';
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 4000) : '';
  if (action === 'redo' && !notes) return void res.status(400).json({ error: 'Write what the AI should keep or remove.' });
  const keepRanges = Array.isArray(req.body?.keepRanges) ? req.body.keepRanges : undefined;
  if (keepRanges) validateEdl(project.transcript!.words, { keepRanges }); // throws a clear error before resuming
  resolve({ action, notes, keepRanges }); res.json({ ok: true });
}));
app.get('/api/projects/:id/auto/frames/:n', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const n = Number(routeParam(req.params.n));
  if (!Number.isInteger(n) || n < 0 || n >= FRAME_COUNT) return void res.status(404).json({ error: 'No such frame' });
  const file = framePaths(thumbDir(project), n).small; if (!(await fs.stat(file).catch(() => null))) return void res.status(404).json({ error: 'No such frame' });
  res.sendFile(file);
}));
// Remake the thumbnail and post caption with AI (optionally with the owner's notes).
app.post('/api/projects/:id/auto/package', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const job = await loadAutoJob(project);
  if (!job || job.state !== 'completed') return void res.status(409).json({ error: 'The reel is not finished yet.' });
  if (job.package?.state === 'running') return void res.status(409).json({ error: 'Already making the thumbnail.' });
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 2000) : '';
  job.options.thumbnail = true; job.options.postCaption = true;
  const context = await projectUsageContext(project);
  void runWithUsage({ ...context, task: 'package' }, () => makeReelPackage(project, job, notes || undefined)).catch(() => undefined);
  res.status(202).json(jobView(res, job));
}));
// Owner edits: new text / another frame -> re-render the cover (no AI).
app.put('/api/projects/:id/auto/package', route(async (req, res) => {
  const project = getProject(routeParam(req.params.id)); const job = await loadAutoJob(project);
  const pkg = job?.package; if (!job || !pkg || pkg.state === 'running') return void res.status(409).json({ error: 'There is no thumbnail to edit yet.' });
  const body = req.body ?? {};
  const edited = cleanPackage({ frame: body.frame ?? pkg.frame, faces: pkg.faces, lines: body.lines ?? pkg.lines, label: body.label ?? pkg.label, badges: body.badges ?? pkg.badges, caption: body.caption ?? pkg.caption, hashtags: body.hashtags ?? pkg.hashtags });
  const coverChanged = edited.frame !== pkg.frame || JSON.stringify([edited.lines, edited.label, edited.badges]) !== JSON.stringify([pkg.lines, pkg.label, pkg.badges]);
  Object.assign(pkg, edited);
  if (coverChanged || !pkg.thumbnailPath) { job.options.thumbnail = true; await renderPackageThumbnail(project, pkg); pkg.state = 'ready'; pkg.error = undefined; }
  await persistAutoJob(project, job); res.json({ ...jobView(res, job), look: packPreview(await projectPack(project)) });
}));
app.post('/api/projects/:id/auto/stop', route(async (req, res) => {
  const id = routeParam(req.params.id); const job = autoJobs.get(id);
  if (job && (job.state === 'running' || job.state === 'review')) { job.stopRequested = true; reviewWaiters.get(id)?.({ action: 'stop' }); }
  res.json(job ? jobView(res, job) : { state: 'idle' });
}));

app.get('/api/projects/:id/export-status', route(async (req, res) => { const id = routeParam(req.params.id); const job = exportJobs.get(id); if (!job) return void res.json({ state: 'idle', progress: 0, outTime: '00:00:00.000000', speed: '', frame: 0 }); const project = projects.get(id); res.json({ ...job, downloadUrl: job.state === 'completed' && project ? downloadUrlFor(project, job.outputPath) : undefined }); }));
app.post('/api/projects/:id/export-stop', route(async (req, res) => { const projectId = routeParam(req.params.id); const job = exportJobs.get(projectId); if (!job || job.state !== 'running') return void res.status(409).json({ error: 'No export is currently running' }); job.stopRequested = true; job.speed = job.resumable ? 'Stopping after preserving checkpoints…' : 'Stopping…'; const child = exportProcesses.get(projectId); if (child) child.kill('SIGTERM'); res.status(202).json({ stopping: true, resumable: Boolean(job.resumable) }); }));

const PORT = Number(process.env.PORT || 3001); await loadSettings(); await hydrateProjects(true);
// Generation runs inside this process, so anything still marked "generating" at startup was orphaned by a restart (e.g. the dev server reloading) and would spin forever.
for (const project of projects.values()) {
  try {
    const plan = await loadBrollPlan(project.workDir); if (!plan) continue; let changed = false;
    for (const scene of plan.scenes) {
      if (scene.imageStatus === 'generating') { scene.imageStatus = 'failed'; changed = true; }
      if (scene.videoStatus === 'generating') { scene.videoStatus = scene.videoFile ? 'ready' : 'none'; changed = true; }
    }
    if (changed) await saveBrollPlan(project.workDir, plan);
  } catch { /* leave the project as-is */ }
}
// A second copy of the app (a test on another port) shares the projects folder and must not pick up the live app's reels.
if (!process.env.VIDEO_CLEANER_NO_RESUME) { await resumeAutoJobs(); void backfillPhonePreviews(); }
warmCaptionRenderer(os.tmpdir());
if (process.env.NODE_ENV === 'production') { const distDir = path.resolve('dist'); app.use(express.static(distDir)); app.use((_req, res) => res.sendFile(path.join(distDir, 'index.html'))); }
app.listen(PORT, '127.0.0.1', () => { console.log(`Video Cleaner local server: http://127.0.0.1:${PORT} · ${projects.size} local project${projects.size === 1 ? '' : 's'} restored`); });

import type { Project } from './api';

type Props = {
  projects: Project[];
  busy: boolean;
  onNew: () => void;
  onOpen: (project: Project) => void;
  onRename: (project: Project) => void;
  onDelete: (project: Project) => void;
  onRelink: (project: Project) => void;
  onRefresh: () => void;
};

export default function ProjectLibrary({ projects, busy, onNew, onOpen, onRename, onDelete, onRelink, onRefresh }: Props) {
  return <section className="projectLibrary">
    <div className="libraryHero panel">
      <div>
        <span className="eyebrow">LOCAL PROJECT LIBRARY</span>
        <h2>Resume exactly where you stopped.</h2>
        <p>Projects can contain one or several talking-head clips. Transcripts, edits, B-roll images and generated clips stay on this computer while every large original video remains referenced in its existing location.</p>
      </div>
      <div className="libraryHeroActions"><button onClick={onRefresh} disabled={busy}>Refresh</button><button className="primary" onClick={onNew} disabled={busy}>+ New project</button></div>
    </div>

    <div className="libraryHeading"><div><span className="label">RECENT PROJECTS</span><h3>{projects.length ? `${projects.length} local project${projects.length === 1 ? '' : 's'}` : 'No saved projects yet'}</h3></div></div>

    {!projects.length ? <div className="panel libraryEmpty"><strong>Your project library is empty.</strong><p>Create a project once and Video Cleaner will restore it from the local project folder on future launches. You can select multiple compatible video clips in the native picker.</p><button className="primary" onClick={onNew} disabled={busy}>Choose video clips</button></div> : <div className="projectGrid">
      {projects.map((project) => <article className={`panel projectCard ${project.sourceAvailable ? '' : 'sourceMissing'}`} key={project.id}>
        <div className="projectCardHead">
          <div><span className="label">{project.sourceAvailable ? 'LOCAL PROJECT' : 'SOURCE NEEDS RELINK'}</span><h3>{project.name}</h3><small>{project.sourceName}</small></div>
          <span className={project.sourceAvailable ? 'sourceOk' : 'sourceBad'}>{project.sourceAvailable ? 'Source ✓' : 'Source missing'}</span>
        </div>
        <div className="projectFacts">
          {(project.clipCount ?? 1) > 1 && <span>{project.clipCount} clips</span>}
          <span>{project.media.width || '?'}×{project.media.height || '?'}</span>
          <span>{project.media.frameRate ? `${project.media.frameRate.toFixed(1)} fps` : 'fps ?'}</span>
          <span>{String(project.media.videoCodec || 'video').toUpperCase()}</span>
          <span>{formatDuration(project.media.duration)}</span>
          <span>{formatDate(project.updatedAt)}</span>
        </div>
        <div className="projectProgress">
          <StatusPill ok={project.state.proxyReady} label="Proxy" />
          <StatusPill ok={project.state.transcriptReady} label="Transcript" />
          <StatusPill ok={project.state.cleaned} label="Cleaned" />
          <StatusPill ok={project.state.brollPlanned} label={`B-roll ${project.state.brollImages}/${project.state.brollScenes || 0}`} />
          {project.state.brollVideos > 0 && <StatusPill ok label={`${project.state.brollVideos} videos`} />}
        </div>
        {(project.state.missingImages > 0 || project.state.missingVideos > 0) && <p className="resumeHint">Resume available: {project.state.missingImages > 0 ? `${project.state.missingImages} image${project.state.missingImages === 1 ? '' : 's'} missing` : ''}{project.state.missingImages > 0 && project.state.missingVideos > 0 ? ' · ' : ''}{project.state.missingVideos > 0 ? `${project.state.missingVideos} video${project.state.missingVideos === 1 ? '' : 's'} missing` : ''}.</p>}
        <div className="projectActions">
          <button className="primary" onClick={() => onOpen(project)} disabled={busy}>Open</button>
          {!project.sourceAvailable && <button onClick={() => onRelink(project)} disabled={busy}>Relink source</button>}
          <button onClick={() => onRename(project)} disabled={busy}>Rename</button>
          <button className="danger" onClick={() => onDelete(project)} disabled={busy}>Delete project</button>
        </div>
      </article>)}
    </div>}
  </section>;
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? 'progressReady' : 'progressPending'}>{ok ? '✓' : '○'} {label}</span>;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'duration ?';
  const minutes = Math.floor(seconds / 60); const remaining = Math.round(seconds % 60);
  return minutes ? `${minutes}m ${remaining}s` : `${remaining}s`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Saved locally';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

import type { WorkflowStage, WorkflowStep } from './workflow';

type Props = {
  projectName: string;
  steps: WorkflowStep[];
  active: WorkflowStage;
  onNavigate: (step: WorkflowStage) => void;
  onOpenEditor: () => void;
  onProjects: () => void;
  previewOpen: boolean;
};

export default function WorkflowNavigator({ projectName, steps, active, onNavigate, onOpenEditor, onProjects, previewOpen }: Props) {
  const selected = steps.find((step) => step.id === active) ?? steps[0];
  return <section className="creatorNavigator panel" aria-label="Video creation workflow">
    <div className="creatorNavHeader">
      <div className="creatorBreadcrumb"><button onClick={onProjects}>Projects</button><span aria-hidden="true">/</span><strong title={projectName}>{projectName}</strong></div>
      <div className="creatorGlobalActions"><span className="creatorSavedState">Original media preserved · editor autosaves</span><button className="primary" onClick={onOpenEditor} aria-haspopup="dialog" aria-expanded={previewOpen}>{previewOpen ? 'Close quick editor' : 'Preview & edit anytime ↗'}</button></div>
    </div>
    <nav className="creatorStageRail" aria-label="Jump to a workflow stage">
      {steps.map((step, index) => <button
        key={step.id}
        type="button"
        className={`creatorStage ${active === step.id ? 'active' : ''} ${step.status}`}
        aria-current={active === step.id ? 'step' : undefined}
        onClick={() => onNavigate(step.id)}
        title={step.detail}
      ><span className="creatorStepNo">{index + 1}</span><span className="creatorStepWords"><strong>{step.label}</strong><small>{step.status === 'complete' ? 'Ready ✓' : step.status === 'in-progress' ? 'In progress' : step.status === 'needs-source' ? 'Source needed' : 'Optional / available'}</small></span></button>)}
    </nav>
    <div className="creatorStageIntro">
      <div><span className="label">STEP {steps.findIndex((step) => step.id === active) + 1} / {steps.length} · FLEXIBLE WORKFLOW</span><h2>{selected.label}</h2><p>{selected.description}. <span>{selected.detail}.</span></p></div>
      {active !== 'editor' && <button onClick={onOpenEditor}>Edit current project ↗</button>}
    </div>
  </section>;
}

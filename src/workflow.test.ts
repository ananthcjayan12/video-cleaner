import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestedStage, workflowFacts, workflowSteps, type WorkflowStage } from './workflow.js';
import type { BrollPlan, Project, ThumbnailState } from './api.js';

function mockProject(sourceAvailable = true): Project {
  return {
    id: 'test', name: 'Reel', sourceAvailable,
    sourceName: 'raw.mp4', media: { duration: 20, size: 1024, hdr: false },
    createdAt: '', updatedAt: '',
    state: { proxyReady: false, transcriptReady: false, cleaned: false, brollPlanned: false, brollScenes: 0, brollImages: 0, brollVideos: 0, missingImages: 0, missingVideos: 0 },
  };
}
function step(stage: WorkflowStage, steps: ReturnType<typeof workflowSteps>) {
  return steps.find((item) => item.id === stage)!;
}

test('raw source offers editor and export before cleaning or B-roll generation', () => {
  const facts = workflowFacts(mockProject(), 0, false, null, null);
  assert.equal(suggestedStage(facts), 'clean');
  const stages = workflowSteps(facts);
  assert.equal(step('upload', stages).status, 'complete');
  assert.equal(step('editor', stages).status, 'available');
  assert.equal(step('export', stages).status, 'available');
  assert.match(step('thumbnail', stages).detail, /optional/i);
});

test('partial/stale video does not block B-roll still editing', () => {
  const plan = {
    scenes: [
      { id: 'a', imageFile: 'a.png', imageRevision: 2, imageStatus: 'ready', videoFile: 'old.mp4', videoSourceImageRevision: 1, videoStatus: 'stale' },
      { id: 'b', imageFile: 'b.png', imageRevision: 1, imageStatus: 'ready', videoFile: 'b.mp4', videoSourceImageRevision: 1, videoStatus: 'ready' },
      { id: 'c', imageFile: undefined, imageStatus: 'generating' },
    ],
  } as unknown as BrollPlan;
  const facts = workflowFacts(mockProject(), 25, true, plan, null);
  assert.equal(facts.imagesReady, 2);
  assert.equal(facts.videosReady, 1);
  assert.equal(step('assets', workflowSteps(facts)).status, 'in-progress');
  assert.equal(step('editor', workflowSteps(facts)).status, 'available');
  assert.equal(step('export', workflowSteps(facts)).status, 'available');
});

test('source loss blocks source-dependent exports, not optional thumbnail work', () => {
  const facts = workflowFacts(mockProject(false), 12, true, null, { version: 1, hasImage: true, references: [] } as ThumbnailState);
  const steps = workflowSteps(facts);
  assert.equal(step('upload', steps).status, 'needs-source');
  assert.equal(step('editor', steps).status, 'needs-source');
  assert.equal(step('export', steps).status, 'needs-source');
  assert.equal(step('thumbnail', steps).status, 'complete');
  assert.equal(suggestedStage(facts), 'upload');
});

type TranscriptWord = {
  element: HTMLButtonElement;
  start: number;
  end: number;
  text: string;
};

type PreviewDom = {
  video: HTMLVideoElement;
  transcript: HTMLElement;
  words: TranscriptWord[];
  toolbar: HTMLElement;
  playButton: HTMLButtonElement;
  restartButton: HTMLButtonElement;
  followInput: HTMLInputElement;
  speedSelect: HTMLSelectElement;
  timeLabel: HTMLElement;
  nowText: HTMLElement;
};

const WORD_TIME = /^\s*([\d.]+)s\s*[–-]\s*([\d.]+)s\s*$/;

function parseWord(element: HTMLButtonElement): TranscriptWord | null {
  const match = element.title.match(WORD_TIME);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { element, start, end, text: element.textContent?.trim() || '' };
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const remaining = Math.floor(safe % 60);
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function createToolbar() {
  const toolbar = document.createElement('section');
  toolbar.className = 'narrationPreview';
  toolbar.dataset.narrationPreview = 'true';
  toolbar.innerHTML = `
    <div class="narrationPreviewHead">
      <div>
        <span class="label">LIVE NARRATION PREVIEW</span>
        <strong>Follow the cleaned script word by word</strong>
      </div>
      <span class="narrationTime" data-narration-time>0:00 / 0:00</span>
    </div>
    <div class="narrationControls">
      <button type="button" class="primary" data-narration-play>▶ Play narration</button>
      <button type="button" data-narration-restart>↺ Start over</button>
      <label class="narrationSpeed">Speed
        <select data-narration-speed aria-label="Narration playback speed">
          <option value="0.75">0.75×</option>
          <option value="1" selected>1×</option>
          <option value="1.25">1.25×</option>
          <option value="1.5">1.5×</option>
          <option value="2">2×</option>
        </select>
      </label>
      <label class="narrationFollow">
        <input type="checkbox" data-narration-follow checked />
        Auto-follow words
      </label>
    </div>
    <div class="narrationNow" aria-live="polite">
      <span>Now</span>
      <strong data-narration-now>Press play to review the narration.</strong>
    </div>
    <p class="narrationHint">Normal click keeps/removes a word. Cmd/Ctrl-click a word to jump playback there. Playback follows the current cleaned EDL, so removed sections are skipped automatically.</p>
  `;
  return toolbar;
}

function wordIndexAtTime(words: TranscriptWord[], time: number) {
  if (!words.length) return -1;
  let low = 0;
  let high = words.length - 1;
  let candidate = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (words[middle].start <= time + 0.025) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (candidate >= 0 && time <= words[candidate].end + 0.10) return candidate;
  return -1;
}

function scrollWordIntoTranscript(transcript: HTMLElement, word: HTMLElement) {
  const top = word.offsetTop;
  const bottom = top + word.offsetHeight;
  const visibleTop = transcript.scrollTop + transcript.clientHeight * 0.18;
  const visibleBottom = transcript.scrollTop + transcript.clientHeight * 0.82;
  if (top >= visibleTop && bottom <= visibleBottom) return;
  transcript.scrollTo({ top: Math.max(0, top - transcript.clientHeight * 0.42), behavior: 'smooth' });
}

function updateNow(dom: PreviewDom, activeIndex: number) {
  if (activeIndex < 0) {
    dom.nowText.textContent = dom.video.paused ? 'Paused — press play to continue.' : 'Listening…';
    return;
  }
  const start = Math.max(0, activeIndex - 2);
  const end = Math.min(dom.words.length, activeIndex + 7);
  dom.nowText.replaceChildren();
  for (let index = start; index < end; index += 1) {
    const span = document.createElement('span');
    span.textContent = `${dom.words[index].text}${index < end - 1 ? ' ' : ''}`;
    if (index === activeIndex) span.className = 'currentNarrationWord';
    else if (dom.words[index].element.classList.contains('removed')) span.className = 'removedNarrationWord';
    dom.nowText.append(span);
  }
}

export function installNarrationPreview() {
  let dom: PreviewDom | null = null;
  let activeIndex = -1;
  let animationFrame = 0;
  let follow = true;
  let boundVideo: HTMLVideoElement | null = null;
  let boundTranscript: HTMLElement | null = null;

  const stopLoop = () => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  };

  const refreshWordList = () => {
    if (!dom) return;
    dom.words = Array.from(dom.transcript.querySelectorAll<HTMLButtonElement>('.word')).map(parseWord).filter((word): word is TranscriptWord => Boolean(word));
  };

  const update = () => {
    if (!dom) return;
    refreshWordList();
    const time = dom.video.currentTime;
    const nextIndex = wordIndexAtTime(dom.words, time);
    dom.timeLabel.textContent = `${formatTime(time)} / ${formatTime(dom.video.duration || dom.words.at(-1)?.end || 0)}`;
    dom.playButton.textContent = dom.video.paused ? '▶ Play narration' : '❚❚ Pause narration';
    dom.speedSelect.value = String(dom.video.playbackRate || 1);

    if (nextIndex !== activeIndex) {
      if (activeIndex >= 0) dom.words[activeIndex]?.element.classList.remove('narrationActive');
      activeIndex = nextIndex;
      if (activeIndex >= 0) {
        const activeWord = dom.words[activeIndex]?.element;
        activeWord?.classList.add('narrationActive');
        if (follow && activeWord) scrollWordIntoTranscript(dom.transcript, activeWord);
      }
    } else if (activeIndex >= 0) {
      dom.words[activeIndex]?.element.classList.add('narrationActive');
    }
    updateNow(dom, activeIndex);
  };

  const loop = () => {
    update();
    if (dom && !dom.video.paused && !dom.video.ended) animationFrame = requestAnimationFrame(loop);
    else animationFrame = 0;
  };

  const startLoop = () => {
    stopLoop();
    animationFrame = requestAnimationFrame(loop);
  };

  const bind = () => {
    const video = document.querySelector<HTMLVideoElement>('.playerCard video');
    const transcript = document.querySelector<HTMLElement>('.transcriptCard .transcript');
    const transcriptCard = document.querySelector<HTMLElement>('.transcriptCard');
    if (!video || !transcript || !transcriptCard) {
      stopLoop();
      dom = null;
      boundVideo = null;
      boundTranscript = null;
      return;
    }

    if (video === boundVideo && transcript === boundTranscript) {
      refreshWordList();
      update();
      return;
    }

    stopLoop();
    activeIndex = -1;
    boundVideo = video;
    boundTranscript = transcript;

    let toolbar = transcriptCard.querySelector<HTMLElement>('[data-narration-preview]');
    if (!toolbar) {
      toolbar = createToolbar();
      const sectionTitle = transcriptCard.querySelector('.sectionTitle');
      sectionTitle?.insertAdjacentElement('afterend', toolbar);
    }

    const playButton = toolbar.querySelector<HTMLButtonElement>('[data-narration-play]')!;
    const restartButton = toolbar.querySelector<HTMLButtonElement>('[data-narration-restart]')!;
    const followInput = toolbar.querySelector<HTMLInputElement>('[data-narration-follow]')!;
    const speedSelect = toolbar.querySelector<HTMLSelectElement>('[data-narration-speed]')!;
    const timeLabel = toolbar.querySelector<HTMLElement>('[data-narration-time]')!;
    const nowText = toolbar.querySelector<HTMLElement>('[data-narration-now]')!;

    dom = { video, transcript, words: [], toolbar, playButton, restartButton, followInput, speedSelect, timeLabel, nowText };
    follow = followInput.checked;
    refreshWordList();

    if (!video.dataset.narrationPreviewBound) {
      video.dataset.narrationPreviewBound = 'true';
      video.addEventListener('play', startLoop);
      video.addEventListener('pause', update);
      video.addEventListener('ended', update);
      video.addEventListener('seeked', update);
      video.addEventListener('timeupdate', update);
      video.addEventListener('ratechange', update);
      video.addEventListener('loadedmetadata', update);
    }

    if (!toolbar.dataset.narrationPreviewBound) {
      toolbar.dataset.narrationPreviewBound = 'true';
      playButton.addEventListener('click', () => {
        if (!dom) return;
        if (dom.video.paused) void dom.video.play();
        else dom.video.pause();
      });
      restartButton.addEventListener('click', () => {
        if (!dom) return;
        const firstKept = dom.words.find((word) => !word.element.classList.contains('removed'));
        dom.video.currentTime = firstKept?.start ?? 0;
        void dom.video.play();
      });
      speedSelect.addEventListener('change', () => {
        if (!dom) return;
        const rate = Number(speedSelect.value);
        if (Number.isFinite(rate) && rate > 0) dom.video.playbackRate = rate;
      });
      followInput.addEventListener('change', () => { follow = followInput.checked; if (follow) update(); });
    }

    if (!transcript.dataset.narrationPreviewBound) {
      transcript.dataset.narrationPreviewBound = 'true';
      transcript.addEventListener('click', (event) => {
        if (!(event.metaKey || event.ctrlKey) || !dom) return;
        const target = (event.target as HTMLElement).closest<HTMLButtonElement>('.word');
        if (!target) return;
        const word = parseWord(target);
        if (!word) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        dom.video.currentTime = word.start;
        void dom.video.play();
      });
    }

    update();
  };

  const observer = new MutationObserver(() => bind());
  observer.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true });
  bind();

  return () => {
    observer.disconnect();
    stopLoop();
    if (activeIndex >= 0) dom?.words[activeIndex]?.element.classList.remove('narrationActive');
  };
}

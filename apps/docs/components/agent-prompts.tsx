'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AGENT_TASKS, type AgentTask } from '@/lib/agent-tasks';
import { getMarkdownUrl } from '@/lib/markdown-url';
import styles from './agent-prompts.module.css';

/**
 * Absolute once the origin is known, so the prompt survives being pasted into
 * an agent that has no page context. The origin comes from the browser, so a
 * preview or local build hands out its own routes rather than production's.
 */
function buildPrompt(task: AgentTask, origin: string) {
  const markdownPath = getMarkdownUrl(task.guideHref);
  const markdownUrl = origin ? new URL(markdownPath, origin).href : markdownPath;

  return `Read ${markdownUrl} before writing code. Treat it as the source of truth for SuperDoc v2. If it conflicts with prior knowledge, follow the guide.

${task.instruction}`;
}

export function AgentPrompts() {
  const [activeId, setActiveId] = useState(AGENT_TASKS[0].id);
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [origin, setOrigin] = useState('');
  const resetTimerRef = useRef<number>(undefined);
  const activeTask = AGENT_TASKS.find((task) => task.id === activeId) ?? AGENT_TASKS[0];
  const prompt = buildPrompt(activeTask, origin);

  // The static export has no serving origin at build time, so the markup ships
  // the relative route and the browser upgrades it to an absolute URL.
  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(
    () => () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    },
    [],
  );

  function scheduleReset() {
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setStatus('idle'), 1600);
  }

  async function copyPrompt() {
    // Resolve against the live origin rather than state, so a click landing
    // before the mount effect still copies an absolute URL. A relative path is
    // useless once pasted into an agent that has no page context.
    const absolutePrompt = buildPrompt(activeTask, window.location.origin);

    try {
      await navigator.clipboard.writeText(absolutePrompt);
      setStatus('copied');
    } catch {
      setStatus('error');
    }

    scheduleReset();
  }

  function selectTask(id: string) {
    setActiveId(id);
    setStatus('idle');
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
  }

  return (
    <section className={styles.section} aria-labelledby='agent-prompts'>
      <h2 id='agent-prompts'>Point your agent at the right guide.</h2>
      <p className={styles.intro}>Pick the task. Copy the prompt. Your agent reads current docs instead of guessing.</p>

      <div className={styles.shell}>
        <div className={styles.tasks}>
          <h3 id='agent-task-label'>Task</h3>
          <div className={styles.taskList} role='group' aria-labelledby='agent-task-label'>
            {AGENT_TASKS.map((task) => (
              <button
                key={task.id}
                className={styles.task}
                type='button'
                aria-pressed={task.id === activeId}
                onClick={() => selectTask(task.id)}
              >
                <strong>{task.title}</strong>
                <span>{task.summary}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.prompt}>
            <button className={styles.copy} type='button' onClick={copyPrompt}>
              <span aria-live='polite'>
                {status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed' : 'Copy'}
              </span>
            </button>
            <pre>{prompt}</pre>
          </div>

          <div className={styles.footer}>
            <span>Paste into Claude Code, Cursor, Windsurf, or a chat window.</span>
            <Link href={activeTask.guideHref}>
              Open the guide <span aria-hidden='true'>→</span>
            </Link>
          </div>
        </div>
      </div>

      <p className={styles.advanced}>
        Working directly against the operation contract?{' '}
        <Link href='/document-api/mental-model'>Read the Document API mental model</Link>.
      </p>
    </section>
  );
}

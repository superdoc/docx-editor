const review = new URLSearchParams(window.location.search).get('workflow') === 'review';
document.querySelector<HTMLElement>('#mode-controls')!.hidden = review;
document.querySelector<HTMLElement>('#review-controls')!.hidden = !review;
void (review ? import('./review') : import('./modes')).catch((error: unknown) => {
  document.querySelector<HTMLElement>('#status')!.textContent = 'The example could not load.';
  console.error(error);
});

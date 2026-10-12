// Tiny in-process queue. For production replace with Redis (BullMQ) so jobs survive restarts.
export function createQueue(concurrency, worker) {
  const jobs = [];
  let running = 0;

  async function pump() {
    while (running < concurrency && jobs.length) {
      const job = jobs.shift();
      running++;
      worker(job)
        .catch(err => console.error('job failed', err))
        .finally(() => { running--; pump(); });
    }
  }

  return {
    add(job) { jobs.push(job); pump(); },
    size: () => jobs.length + running,
  };
}

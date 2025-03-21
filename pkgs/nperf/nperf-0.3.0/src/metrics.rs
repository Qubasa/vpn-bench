use tracing::*;
use tracing_timing::{Builder, Histogram, TimingSubscriber};

pub struct Metrics {
    d: Dispatch,
}

impl Default for Metrics {
    fn default() -> Self {
        let subscriber =
            Builder::default().build(|| Histogram::new_with_max(1_000_000, 2).unwrap());
        Metrics {
            d: Dispatch::new(subscriber),
        }
    }
}
impl Clone for Metrics {
    fn clone(&self) -> Self {
        Metrics { d: self.d.clone() }
    }
}
impl Metrics {
    pub fn record(&self, record: bool) {
        if record {
            dispatcher::with_default(&self.d, || {
                trace_span!("request").in_scope(|| {
                    // do a little bit of work
                    trace!("gap");
                })
            });
        }
    }

    pub fn print(&self) {
        self.d
            .downcast_ref::<TimingSubscriber>()
            .unwrap()
            .force_synchronize();
        self.d
            .downcast_ref::<TimingSubscriber>()
            .unwrap()
            .with_histograms(|hs| {
                if hs.len() != 1 {
                    return;
                }
                let hs = &mut hs.get_mut("request").unwrap();

                hs.get_mut("gap").unwrap().refresh();

                let h = &hs["gap"];
                println!("Inter-packet gap metrics:");
                println!(
                    "avg: {:.1}µs, p50: {}µs, p90: {}µs, p99: {}µs, max: {}µs, {} traces",
                    h.mean() / 1000.0,
                    h.value_at_quantile(0.5) / 1_000,
                    h.value_at_quantile(0.9) / 1_000,
                    h.value_at_quantile(0.99) / 1_000,
                    h.max() / 1_000,
                    h.len()
                );
                for v in break_once(
                    h.iter_linear(1_000).skip_while(|v| v.quantile() < 0.01),
                    |v| v.quantile() > 0.95,
                ) {
                    println!(
                        "{:4.1}µs | {:40} | {:4.1}th %-ile",
                        (v.value_iterated_to() + 1) as f64 / 1_000 as f64,
                        "*".repeat(
                            (v.count_since_last_iteration() as f64 * 40.0 / h.len() as f64).ceil()
                                as usize
                        ),
                        v.percentile(),
                    );
                }
                println!("");
            });
    }
}

fn break_once<I, F>(it: I, mut f: F) -> impl Iterator<Item = I::Item>
where
    I: IntoIterator,
    F: FnMut(&I::Item) -> bool,
{
    let mut got_true = false;
    it.into_iter().take_while(move |i| {
        if got_true {
            // we've already yielded when f was true
            return false;
        }
        if f(i) {
            // this must be the first time f returns true
            // we should yield i, and then no more
            got_true = true;
        }
        // f returned false, so we should keep yielding
        true
    })
}

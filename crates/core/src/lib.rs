//! OrbitScope core: everything that computes, nothing that draws.
//!
//! Kept free of any UI/rendering dependency so it can be unit-tested,
//! validated against other tools, and reused from a CLI, Python (PyO3) or WASM.

pub mod access;
pub mod catalog;
pub mod frames;
pub mod math;
pub mod orbit;
pub mod sensor;
pub mod sun;
pub mod time;

pub use frames::Geodetic;
pub use math::V3;
pub use orbit::{Keplerian, Satellite, State};
pub use sensor::{Fov, Sensor};
pub use time::Epoch;

// Movement tuning constants. See docs/MOVEMENT_SPEC.md for the reasoning behind each value.
// Units follow Source-convention scaling (roughly 1 unit ~= 1 inch). Keep world geometry
// scaled consistently to this so the constants below stay meaningful.

export const TICK_RATE = 64;
export const TICK_DT = 1 / TICK_RATE;

export const GROUND_ACCEL = 10;
export const AIR_ACCEL = 10;
export const AIR_WISH_SPEED_CAP = 30;
export const MAX_GROUND_SPEED = 320;
export const FRICTION = 4;
export const STOP_SPEED = 100;
export const JUMP_IMPULSE = 270; // tune to hit a target jump height with GRAVITY below
export const GRAVITY = 800;

// cos of ~45 degrees. Surfaces with a normal.y below this are treated as "surf," not "ground" -
// they don't get friction/ground-accelerate, and velocity is clipped along them instead.
export const GROUND_NORMAL_MIN_Y = 0.7;

// Config flag, not a hard rule - see docs/MOVEMENT_SPEC.md "Jump" section.
export const AUTO_BHOP_ENABLED = false;

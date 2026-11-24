// STUB (owned by the vehicles agent). Vehicle catalogue. All designs are original (no real brands).
// dims in metres; mass kg; power kW; topSpeed m/s.
export const VEHICLE_SPECS = {
	compact: { name: 'Pico Hatch', class: 'compact', mass: 1150, power: 80, topSpeed: 48, dims: { length: 3.9, width: 1.75, height: 1.48, wheelBase: 2.5, wheelRadius: 0.31 }, colors: ['#d23b3b', '#f2f2f2', '#2b6cb0', '#f6c445', '#3a3a3a', '#7fc8a9'] },
	sedan: { name: 'Meridian Sedan', class: 'sedan', mass: 1450, power: 130, topSpeed: 55, dims: { length: 4.8, width: 1.85, height: 1.45, wheelBase: 2.8, wheelRadius: 0.33 }, colors: ['#1f2d3d', '#c0c5cc', '#ffffff', '#7a1f2b', '#2f4f3f', '#111111'] },
	taxi: { name: 'Meridian Cab', class: 'sedan', mass: 1480, power: 120, topSpeed: 52, dims: { length: 4.8, width: 1.85, height: 1.5, wheelBase: 2.8, wheelRadius: 0.33 }, colors: ['#2fd3c6'] },
	suv: { name: 'Caimán SUV', class: 'suv', mass: 2100, power: 190, topSpeed: 52, dims: { length: 4.9, width: 1.98, height: 1.8, wheelBase: 2.95, wheelRadius: 0.38 }, colors: ['#111111', '#ffffff', '#5b6670', '#203a5c', '#8a6f4e'] },
	pickup: { name: 'Tarpon Pickup', class: 'pickup', mass: 2200, power: 200, topSpeed: 50, dims: { length: 5.6, width: 2.0, height: 1.9, wheelBase: 3.5, wheelRadius: 0.4 }, colors: ['#b33a2b', '#ffffff', '#2a2f36', '#3f5f8f', '#c9b28a'] },
	van: { name: 'Pelican Van', class: 'van', mass: 2400, power: 120, topSpeed: 42, dims: { length: 5.3, width: 2.0, height: 2.3, wheelBase: 3.3, wheelRadius: 0.36 }, colors: ['#ffffff', '#d9d9d9', '#2b4c7e'] },
	sports: { name: 'Stingray GT', class: 'sports', mass: 1400, power: 320, topSpeed: 78, dims: { length: 4.5, width: 1.92, height: 1.25, wheelBase: 2.6, wheelRadius: 0.34 }, colors: ['#ff3b30', '#ffcc00', '#1e90ff', '#111111', '#ffffff', '#ff6a00'] },
	super: { name: 'Halcón V12', class: 'super', mass: 1500, power: 520, topSpeed: 92, dims: { length: 4.7, width: 2.04, height: 1.12, wheelBase: 2.7, wheelRadius: 0.35 }, colors: ['#ff7a00', '#c6ff00', '#e10600', '#f2f2f2', '#2a2a2a', '#7b2ff7'] },
	muscle: { name: 'Bravado 68', class: 'muscle', mass: 1650, power: 300, topSpeed: 70, dims: { length: 5.0, width: 1.95, height: 1.32, wheelBase: 2.9, wheelRadius: 0.35 }, colors: ['#0b3d91', '#ffb000', '#9b111e', '#1b1b1b', '#e5e5e5'] },
	police: { name: 'Interceptor', class: 'sedan', mass: 1750, power: 280, topSpeed: 70, dims: { length: 5.0, width: 1.95, height: 1.5, wheelBase: 2.95, wheelRadius: 0.34 }, colors: ['#ffffff'], police: true },
};
export const CIVILIAN_TYPES = ['compact', 'sedan', 'sedan', 'taxi', 'suv', 'pickup', 'van', 'sports', 'muscle', 'compact', 'sedan', 'suv', 'super'];

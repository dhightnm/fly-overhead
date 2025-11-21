import React, { useState } from 'react';
import type {
  UserPlane,
  CreatePlaneRequest,
  PlaneCategory,
  AirspeedUnit,
  LengthUnit,
  WeightUnit,
  FuelUnit,
} from '../../types';
import { getErrorMessage } from '../../services/api';
import './YourPlanesCard.css';

interface YourPlanesCardProps {
  planes: UserPlane[];
  onCreatePlane: (payload: CreatePlaneRequest) => Promise<UserPlane>;
  onUpdatePlane: (planeId: number, payload: CreatePlaneRequest) => Promise<UserPlane>;
}

type FormState = {
  tailNumber: string;
  displayName: string;
  callsign: string;
  serialNumber: string;
  manufacturer: string;
  model: string;
  yearOfManufacture: string;
  aircraftType: string;
  category: PlaneCategory;
  homeAirportCode: string;
  primaryColor: string;
  secondaryColor: string;
  airspeedUnit: AirspeedUnit;
  lengthUnit: LengthUnit;
  weightUnit: WeightUnit;
  fuelUnit: FuelUnit;
  fuelType: string;
  engineType: string;
  engineCount: string;
  propConfiguration: string;
  avionicsText: string;
  defaultCruiseAltitude: string;
  serviceCeiling: string;
  cruiseSpeed: string;
  maxSpeed: string;
  stallSpeed: string;
  bestGlideSpeed: string;
  bestGlideRatio: string;
  emptyWeight: string;
  maxTakeoffWeight: string;
  maxLandingWeight: string;
  fuelCapacityTotal: string;
  fuelCapacityUsable: string;
  startTaxiFuel: string;
  fuelBurnPerHour: string;
  operatingCostPerHour: string;
  totalFlightHours: string;
  notes: string;
};

const categoryOptions: { label: string; value: PlaneCategory }[] = [
  { label: 'Airplane', value: 'airplane' },
  { label: 'Rotorcraft', value: 'rotorcraft' },
  { label: 'Glider', value: 'glider' },
  { label: 'Experimental', value: 'experimental' },
  { label: 'Other', value: 'other' },
];

const airspeedOptions: AirspeedUnit[] = ['knots', 'mph'];
const lengthOptions: LengthUnit[] = ['feet', 'meters', 'inches', 'centimeters'];
const weightOptions: WeightUnit[] = ['pounds', 'kilograms'];
const fuelOptions: FuelUnit[] = ['gallons', 'liters', 'pounds', 'kilograms'];

const getDefaultFormState = (): FormState => ({
  tailNumber: '',
  displayName: '',
  callsign: '',
  serialNumber: '',
  manufacturer: '',
  model: '',
  yearOfManufacture: '',
  aircraftType: '',
  category: 'airplane',
  homeAirportCode: '',
  primaryColor: '',
  secondaryColor: '',
  airspeedUnit: 'knots',
  lengthUnit: 'feet',
  weightUnit: 'pounds',
  fuelUnit: 'gallons',
  fuelType: '',
  engineType: '',
  engineCount: '',
  propConfiguration: '',
  avionicsText: '',
  defaultCruiseAltitude: '',
  serviceCeiling: '',
  cruiseSpeed: '',
  maxSpeed: '',
  stallSpeed: '',
  bestGlideSpeed: '',
  bestGlideRatio: '',
  emptyWeight: '',
  maxTakeoffWeight: '',
  maxLandingWeight: '',
  fuelCapacityTotal: '',
  fuelCapacityUsable: '',
  startTaxiFuel: '',
  fuelBurnPerHour: '',
  operatingCostPerHour: '',
  totalFlightHours: '',
  notes: '',
});

const formatAvionicsText = (plane: UserPlane): string => {
  if (!Array.isArray(plane.avionics) || plane.avionics.length === 0) {
    return '';
  }
  return plane.avionics
    .map((entry) => {
      if (!entry) {
        return null;
      }
      if (entry.name) {
        return entry.name;
      }
      const manufacturer = entry.manufacturer || '';
      const model = entry.model || '';
      return [manufacturer, model].filter(Boolean).join(' - ') || null;
    })
    .filter(Boolean)
    .join('\n');
};

const numberToString = (value: number | null | undefined): string => (
  value === null || value === undefined ? '' : value.toString()
);

const mapPlaneToFormState = (plane: UserPlane): FormState => ({
  tailNumber: plane.tailNumber || '',
  displayName: plane.displayName || '',
  callsign: plane.callsign || '',
  serialNumber: plane.serialNumber || '',
  manufacturer: plane.manufacturer || '',
  model: plane.model || '',
  yearOfManufacture: numberToString(plane.yearOfManufacture),
  aircraftType: plane.aircraftType || '',
  category: plane.category || 'airplane',
  homeAirportCode: plane.homeAirportCode || '',
  primaryColor: plane.primaryColor || '',
  secondaryColor: plane.secondaryColor || '',
  airspeedUnit: plane.airspeedUnit || 'knots',
  lengthUnit: plane.lengthUnit || 'feet',
  weightUnit: plane.weightUnit || 'pounds',
  fuelUnit: plane.fuelUnit || 'gallons',
  fuelType: plane.fuelType || '',
  engineType: plane.engineType || '',
  engineCount: numberToString(plane.engineCount),
  propConfiguration: plane.propConfiguration || '',
  avionicsText: formatAvionicsText(plane),
  defaultCruiseAltitude: numberToString(plane.defaultCruiseAltitude),
  serviceCeiling: numberToString(plane.serviceCeiling),
  cruiseSpeed: numberToString(plane.cruiseSpeed),
  maxSpeed: numberToString(plane.maxSpeed),
  stallSpeed: numberToString(plane.stallSpeed),
  bestGlideSpeed: numberToString(plane.bestGlideSpeed),
  bestGlideRatio: numberToString(plane.bestGlideRatio),
  emptyWeight: numberToString(plane.emptyWeight),
  maxTakeoffWeight: numberToString(plane.maxTakeoffWeight),
  maxLandingWeight: numberToString(plane.maxLandingWeight),
  fuelCapacityTotal: numberToString(plane.fuelCapacityTotal),
  fuelCapacityUsable: numberToString(plane.fuelCapacityUsable),
  startTaxiFuel: numberToString(plane.startTaxiFuel),
  fuelBurnPerHour: numberToString(plane.fuelBurnPerHour),
  operatingCostPerHour: numberToString(plane.operatingCostPerHour),
  totalFlightHours: numberToString(plane.totalFlightHours),
  notes: plane.notes || '',
});

const parseNumberInput = (value: string): number | undefined => {
  if (!value || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const parseAvionicsText = (value: string): CreatePlaneRequest['avionics'] => (
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
);

const buildPayload = (form: FormState): CreatePlaneRequest => ({
  tailNumber: form.tailNumber,
  displayName: form.displayName || undefined,
  callsign: form.callsign || undefined,
  serialNumber: form.serialNumber || undefined,
  manufacturer: form.manufacturer || undefined,
  model: form.model || undefined,
  yearOfManufacture: parseNumberInput(form.yearOfManufacture),
  aircraftType: form.aircraftType || undefined,
  category: form.category,
  homeAirportCode: form.homeAirportCode || undefined,
  primaryColor: form.primaryColor || undefined,
  secondaryColor: form.secondaryColor || undefined,
  airspeedUnit: form.airspeedUnit,
  lengthUnit: form.lengthUnit,
  weightUnit: form.weightUnit,
  fuelUnit: form.fuelUnit,
  fuelType: form.fuelType || undefined,
  engineType: form.engineType || undefined,
  engineCount: parseNumberInput(form.engineCount),
  propConfiguration: form.propConfiguration || undefined,
  avionics: parseAvionicsText(form.avionicsText),
  defaultCruiseAltitude: parseNumberInput(form.defaultCruiseAltitude),
  serviceCeiling: parseNumberInput(form.serviceCeiling),
  cruiseSpeed: parseNumberInput(form.cruiseSpeed),
  maxSpeed: parseNumberInput(form.maxSpeed),
  stallSpeed: parseNumberInput(form.stallSpeed),
  bestGlideSpeed: parseNumberInput(form.bestGlideSpeed),
  bestGlideRatio: parseNumberInput(form.bestGlideRatio),
  emptyWeight: parseNumberInput(form.emptyWeight),
  maxTakeoffWeight: parseNumberInput(form.maxTakeoffWeight),
  maxLandingWeight: parseNumberInput(form.maxLandingWeight),
  fuelCapacityTotal: parseNumberInput(form.fuelCapacityTotal),
  fuelCapacityUsable: parseNumberInput(form.fuelCapacityUsable),
  startTaxiFuel: parseNumberInput(form.startTaxiFuel),
  fuelBurnPerHour: parseNumberInput(form.fuelBurnPerHour),
  operatingCostPerHour: parseNumberInput(form.operatingCostPerHour),
  totalFlightHours: parseNumberInput(form.totalFlightHours),
  notes: form.notes || undefined,
});

const YourPlanesCard: React.FC<YourPlanesCardProps> = ({ planes, onCreatePlane, onUpdatePlane }) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPlane, setEditingPlane] = useState<UserPlane | null>(null);
  const [formState, setFormState] = useState<FormState>(getDefaultFormState());
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setFormState((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const resetForm = () => {
    setFormState(getDefaultFormState());
    setError(null);
    setIsFormOpen(false);
    setEditingPlane(null);
  };

  const handleEditPlane = (plane: UserPlane) => {
    setEditingPlane(plane);
    setFormState(mapPlaneToFormState(plane));
    setIsFormOpen(true);
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formState.tailNumber.trim()) {
      setError('Tail number is required');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const payload = buildPayload(formState);
      if (editingPlane) {
        await onUpdatePlane(editingPlane.id, payload);
      } else {
        await onCreatePlane(payload);
      }
      resetForm();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const formTitle = editingPlane ? `Edit ${editingPlane.tailNumber}` : 'Add Plane';

  return (
    <div className="portal-card your-planes-card">
      <div className="your-planes-header">
        <div>
          <h2>Your Planes</h2>
          <p>Maintain performance specs, preferred units, and avionics for each aircraft you operate.</p>
        </div>
        <button
          type="button"
          className="primary"
          onClick={() => (isFormOpen && !editingPlane ? resetForm() : setIsFormOpen(true))}
          aria-expanded={isFormOpen}
        >
          {isFormOpen && !editingPlane ? 'Close Form' : 'Add Plane'}
        </button>
      </div>

      {planes.length === 0 && (
        <div className="planes-empty-state">
          <p>No aircraft profiles yet.</p>
          <p className="hint">Add your first plane to quickly reference cruise speeds, unit preferences, and avionics loadouts.</p>
        </div>
      )}

      {planes.length > 0 && (
        <div className="planes-grid">
          {planes.map((plane) => (
            <article key={plane.id} className="plane-card">
              <div className="plane-card-header">
                <div>
                  <p className="plane-tail">{plane.tailNumber}</p>
                  <h3>{plane.displayName || plane.model || plane.tailNumber}</h3>
                  <p className="plane-metadata">
                    {[plane.manufacturer, plane.model].filter(Boolean).join(' • ') || '—'}
                  </p>
                </div>
                <div className="plane-card-actions">
                  <span className="plane-category">{plane.category || 'general'}</span>
                  <button type="button" onClick={() => handleEditPlane(plane)}>Edit</button>
                </div>
              </div>

              <div className="plane-meta">
                <div>
                  <span>Home Airport</span>
                  <strong>{plane.homeAirportCode || 'Not set'}</strong>
                </div>
                <div>
                  <span>Type</span>
                  <strong>{plane.aircraftType || '—'}</strong>
                </div>
                <div>
                  <span>Fuel</span>
                  <strong>{plane.fuelType || '—'}</strong>
                </div>
              </div>

              <div className="plane-performance">
                <div>
                  <span>Cruise</span>
                  <strong>{plane.cruiseSpeed ? `${plane.cruiseSpeed} ${plane.airspeedUnit}` : '—'}</strong>
                </div>
                <div>
                  <span>Ceiling</span>
                  <strong>{plane.serviceCeiling ? `${plane.serviceCeiling.toLocaleString()} ft` : '—'}</strong>
                </div>
                <div>
                  <span>Fuel Burn</span>
                  <strong>{plane.fuelBurnPerHour ? `${plane.fuelBurnPerHour} ${plane.fuelUnit}/hr` : '—'}</strong>
                </div>
              </div>

              {(plane.primaryColor || plane.secondaryColor) && (
                <div className="plane-colors">
                  {plane.primaryColor && <span className="color-chip" style={{ backgroundColor: plane.primaryColor }} aria-label="Primary color" />}
                  {plane.secondaryColor && <span className="color-chip" style={{ backgroundColor: plane.secondaryColor }} aria-label="Secondary color" />}
                </div>
              )}

              {plane.notes && (
                <p className="plane-notes">{plane.notes}</p>
              )}
            </article>
          ))}
        </div>
      )}

      {isFormOpen && (
        <form className="plane-form" onSubmit={handleSubmit}>
          <div className="form-section">
            <div className="form-section-header">
              <h3>{formTitle}</h3>
              <p className="section-subtitle">Core identity details for the aircraft</p>
            </div>
            <div className="form-grid">
              <label>
                <span>Tail Number*</span>
                <input
                  name="tailNumber"
                  value={formState.tailNumber}
                  onChange={handleInputChange}
                  placeholder="e.g. N160RA"
                  required
                />
              </label>
              <label>
                <span>Display Name</span>
                <input
                  name="displayName"
                  value={formState.displayName}
                  onChange={handleInputChange}
                  placeholder="Romeo Alpha"
                />
              </label>
              <label>
                <span>Callsign</span>
                <input
                  name="callsign"
                  value={formState.callsign}
                  onChange={handleInputChange}
                  placeholder="optional"
                />
              </label>
              <label>
                <span>Serial Number</span>
                <input
                  name="serialNumber"
                  value={formState.serialNumber}
                  onChange={handleInputChange}
                  placeholder="Manufacturer serial"
                />
              </label>
              <label>
                <span>Manufacturer</span>
                <input
                  name="manufacturer"
                  value={formState.manufacturer}
                  onChange={handleInputChange}
                  placeholder="Cessna, Cirrus..."
                />
              </label>
              <label>
                <span>Model</span>
                <input
                  name="model"
                  value={formState.model}
                  onChange={handleInputChange}
                  placeholder="172N, SR22..."
                />
              </label>
              <label>
                <span>Year</span>
                <input
                  name="yearOfManufacture"
                  type="number"
                  min={1903}
                  max={2100}
                  value={formState.yearOfManufacture}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Aircraft Type</span>
                <input
                  name="aircraftType"
                  value={formState.aircraftType}
                  onChange={handleInputChange}
                  placeholder="ICAO type (e.g. C172)"
                />
              </label>
              <label>
                <span>Category</span>
                <select
                  name="category"
                  value={formState.category}
                  onChange={handleInputChange}
                >
                  {categoryOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Home Airport</span>
                <input
                  name="homeAirportCode"
                  value={formState.homeAirportCode}
                  onChange={handleInputChange}
                  placeholder="ICAO / FAA code"
                />
              </label>
              <label>
                <span>Primary Color</span>
                <input
                  name="primaryColor"
                  value={formState.primaryColor}
                  onChange={handleInputChange}
                  placeholder="White"
                />
              </label>
              <label>
                <span>Secondary Color</span>
                <input
                  name="secondaryColor"
                  value={formState.secondaryColor}
                  onChange={handleInputChange}
                  placeholder="Blue"
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-header">
              <h3>Units & Powerplant</h3>
              <p className="section-subtitle">Tell us about the engine, fuel, and measurement preferences.</p>
            </div>
            <div className="form-grid">
              <label>
                <span>Airspeed Unit</span>
                <select name="airspeedUnit" value={formState.airspeedUnit} onChange={handleInputChange}>
                  {airspeedOptions.map((unit) => (<option key={unit} value={unit}>{unit}</option>))}
                </select>
              </label>
              <label>
                <span>Length Unit</span>
                <select name="lengthUnit" value={formState.lengthUnit} onChange={handleInputChange}>
                  {lengthOptions.map((unit) => (<option key={unit} value={unit}>{unit}</option>))}
                </select>
              </label>
              <label>
                <span>Weight Unit</span>
                <select name="weightUnit" value={formState.weightUnit} onChange={handleInputChange}>
                  {weightOptions.map((unit) => (<option key={unit} value={unit}>{unit}</option>))}
                </select>
              </label>
              <label>
                <span>Fuel Unit</span>
                <select name="fuelUnit" value={formState.fuelUnit} onChange={handleInputChange}>
                  {fuelOptions.map((unit) => (<option key={unit} value={unit}>{unit}</option>))}
                </select>
              </label>
              <label>
                <span>Fuel Type</span>
                <input
                  name="fuelType"
                  value={formState.fuelType}
                  onChange={handleInputChange}
                  placeholder="100LL, Jet-A..."
                />
              </label>
              <label>
                <span>Engine Type</span>
                <input
                  name="engineType"
                  value={formState.engineType}
                  onChange={handleInputChange}
                  placeholder="Piston, Turboprop..."
                />
              </label>
              <label>
                <span>Engine Count</span>
                <input
                  name="engineCount"
                  type="number"
                  min={0}
                  value={formState.engineCount}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Prop Configuration</span>
                <input
                  name="propConfiguration"
                  value={formState.propConfiguration}
                  onChange={handleInputChange}
                  placeholder="Constant Speed, Fixed Pitch..."
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-header">
              <h3>Performance</h3>
              <p className="section-subtitle">Speed and altitude settings to inform planning tools.</p>
            </div>
            <div className="form-grid">
              <label>
                <span>Default Cruise Altitude (ft)</span>
                <input
                  name="defaultCruiseAltitude"
                  type="number"
                  min={0}
                  value={formState.defaultCruiseAltitude}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Service Ceiling (ft)</span>
                <input
                  name="serviceCeiling"
                  type="number"
                  min={0}
                  value={formState.serviceCeiling}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Cruise Speed ({formState.airspeedUnit})</span>
                <input
                  name="cruiseSpeed"
                  type="number"
                  min={0}
                  value={formState.cruiseSpeed}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Max Speed ({formState.airspeedUnit})</span>
                <input
                  name="maxSpeed"
                  type="number"
                  min={0}
                  value={formState.maxSpeed}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Stall Speed ({formState.airspeedUnit})</span>
                <input
                  name="stallSpeed"
                  type="number"
                  min={0}
                  value={formState.stallSpeed}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Best Glide Speed ({formState.airspeedUnit})</span>
                <input
                  name="bestGlideSpeed"
                  type="number"
                  min={0}
                  value={formState.bestGlideSpeed}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Best Glide Ratio</span>
                <input
                  name="bestGlideRatio"
                  type="number"
                  min={0}
                  step="0.1"
                  value={formState.bestGlideRatio}
                  onChange={handleInputChange}
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-header">
              <h3>Weight, Fuel & Costs</h3>
              <p className="section-subtitle">Capture weight & balance data plus hourly costs.</p>
            </div>
            <div className="form-grid">
              <label>
                <span>Empty Weight ({formState.weightUnit})</span>
                <input
                  name="emptyWeight"
                  type="number"
                  min={0}
                  value={formState.emptyWeight}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Max Takeoff Weight ({formState.weightUnit})</span>
                <input
                  name="maxTakeoffWeight"
                  type="number"
                  min={0}
                  value={formState.maxTakeoffWeight}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Max Landing Weight ({formState.weightUnit})</span>
                <input
                  name="maxLandingWeight"
                  type="number"
                  min={0}
                  value={formState.maxLandingWeight}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Total Fuel Capacity ({formState.fuelUnit})</span>
                <input
                  name="fuelCapacityTotal"
                  type="number"
                  min={0}
                  value={formState.fuelCapacityTotal}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Usable Fuel ({formState.fuelUnit})</span>
                <input
                  name="fuelCapacityUsable"
                  type="number"
                  min={0}
                  value={formState.fuelCapacityUsable}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Start/Taxi Fuel ({formState.fuelUnit})</span>
                <input
                  name="startTaxiFuel"
                  type="number"
                  min={0}
                  value={formState.startTaxiFuel}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Fuel Burn ({formState.fuelUnit}/hr)</span>
                <input
                  name="fuelBurnPerHour"
                  type="number"
                  min={0}
                  step="0.1"
                  value={formState.fuelBurnPerHour}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Operating Cost ($/hr)</span>
                <input
                  name="operatingCostPerHour"
                  type="number"
                  min={0}
                  step="0.1"
                  value={formState.operatingCostPerHour}
                  onChange={handleInputChange}
                />
              </label>
              <label>
                <span>Total Flight Hours</span>
                <input
                  name="totalFlightHours"
                  type="number"
                  min={0}
                  step="0.1"
                  value={formState.totalFlightHours}
                  onChange={handleInputChange}
                />
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-header">
              <h3>Avionics & Notes</h3>
              <p className="section-subtitle">List key avionics (one per line) and any quirks or reminders.</p>
            </div>
            <label className="notes-field">
              <span>Avionics</span>
              <textarea
                name="avionicsText"
                rows={3}
                value={formState.avionicsText}
                onChange={handleInputChange}
                placeholder="Garmin G1000&#10;GTN 750"
              />
            </label>
            <label className="notes-field">
              <span>Notes</span>
              <textarea
                name="notes"
                rows={3}
                value={formState.notes}
                onChange={handleInputChange}
                placeholder="Procedures, quirks, or maintenance reminders"
              />
            </label>
          </div>

          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="plane-form-actions">
            <button type="button" onClick={resetForm} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : editingPlane ? 'Save Changes' : 'Save Plane'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default YourPlanesCard;

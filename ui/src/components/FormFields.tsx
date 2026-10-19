/**
 * Thin typed inputs on top of {@link Field}. List inputs keep a local draft while focused so
 * typing a separator does not get normalised away mid-keystroke, yet every keystroke still
 * reaches the document (and therefore the source pane).
 */
import { type ReactNode, useId, useState } from "react";
import { joinCommaList, joinLines, splitCommaList, splitLines } from "../editors/lists.js";
import { Field } from "./Field.js";

type Common = {
	label: string;
	hint?: string;
	error?: string;
	disabled?: boolean;
};

export type TextFieldProps = Common & {
	value: string;
	onChange(value: string): void;
	placeholder?: string;
	multiline?: boolean;
	rows?: number;
	mono?: boolean;
	type?: "text" | "url";
	autoComplete?: string;
};

export function TextField({
	value,
	onChange,
	placeholder,
	multiline,
	rows,
	mono,
	type = "text",
	autoComplete = "off",
	disabled,
	...field
}: TextFieldProps) {
	const className = mono ? "mono" : undefined;
	return (
		<Field {...field}>
			{(control) =>
				multiline ? (
					<textarea
						{...control}
						className={className}
						value={value}
						rows={rows ?? 4}
						placeholder={placeholder}
						disabled={disabled}
						onChange={(e) => onChange(e.target.value)}
					/>
				) : (
					<input
						{...control}
						className={className}
						type={type}
						value={value}
						placeholder={placeholder}
						disabled={disabled}
						autoComplete={autoComplete}
						spellCheck={!mono}
						onChange={(e) => onChange(e.target.value)}
					/>
				)
			}
		</Field>
	);
}

export type NumberFieldProps = Common & {
	value: number | undefined;
	onChange(value: number | undefined): void;
	min?: number;
	max?: number;
	step?: number;
	placeholder?: string;
};

export function NumberField({
	value,
	onChange,
	min,
	max,
	step,
	placeholder,
	disabled,
	...field
}: NumberFieldProps) {
	return (
		<Field {...field}>
			{(control) => (
				<input
					{...control}
					type="number"
					inputMode="decimal"
					value={value ?? ""}
					min={min}
					max={max}
					step={step}
					placeholder={placeholder}
					disabled={disabled}
					onChange={(e) => {
						const n = e.target.valueAsNumber;
						onChange(Number.isNaN(n) ? undefined : n);
					}}
				/>
			)}
		</Field>
	);
}

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectFieldProps = Common & {
	value: string;
	options: readonly SelectOption[];
	onChange(value: string): void;
};

export function SelectField({ value, options, onChange, disabled, ...field }: SelectFieldProps) {
	return (
		<Field {...field}>
			{(control) => (
				<select
					{...control}
					value={value}
					disabled={disabled}
					onChange={(e) => onChange(e.target.value)}
				>
					{options.map((o) => (
						<option key={o.value} value={o.value} disabled={o.disabled}>
							{o.label}
						</option>
					))}
				</select>
			)}
		</Field>
	);
}

export type CheckboxFieldProps = {
	label: string;
	hint?: string;
	checked: boolean;
	onChange(checked: boolean): void;
	disabled?: boolean;
};

export function CheckboxField({ label, hint, checked, onChange, disabled }: CheckboxFieldProps) {
	const id = useId();
	const hintId = hint ? `${id}-hint` : undefined;
	return (
		<div className="field field--check">
			<label className="check" htmlFor={id}>
				<input
					id={id}
					type="checkbox"
					checked={checked}
					disabled={disabled}
					aria-describedby={hintId}
					onChange={(e) => onChange(e.target.checked)}
				/>
				<span>{label}</span>
			</label>
			{hint ? (
				<span className="field__hint" id={hintId}>
					{hint}
				</span>
			) : null}
		</div>
	);
}

type ListFieldProps = Common & {
	items: readonly string[];
	onChange(items: string[]): void;
	placeholder?: string;
};

/** Keeps the typed text while focused; parses on every change so the document stays live. */
function useListDraft(
	items: readonly string[],
	join: (items: readonly string[]) => string,
	split: (text: string) => string[],
	onChange: (items: string[]) => void,
) {
	const [draft, setDraft] = useState<string | undefined>(undefined);
	const value = draft ?? join(items);
	return {
		value,
		onFocus: () => setDraft(join(items)),
		onBlur: () => setDraft(undefined),
		onInput: (text: string) => {
			setDraft(text);
			onChange(split(text));
		},
	};
}

/** Comma-separated short values (tags, traits). */
export function TagsField({ items, onChange, placeholder, disabled, ...field }: ListFieldProps) {
	const draft = useListDraft(items, joinCommaList, splitCommaList, onChange);
	return (
		<Field {...field} hint={field.hint ?? "Comma-separated."}>
			{(control) => (
				<input
					{...control}
					type="text"
					value={draft.value}
					placeholder={placeholder}
					disabled={disabled}
					autoComplete="off"
					onFocus={draft.onFocus}
					onBlur={draft.onBlur}
					onChange={(e) => draft.onInput(e.target.value)}
				/>
			)}
		</Field>
	);
}

/** One value per line (hints, examples). */
export function LinesField({ items, onChange, placeholder, disabled, ...field }: ListFieldProps) {
	const draft = useListDraft(items, joinLines, splitLines, onChange);
	return (
		<Field {...field} hint={field.hint ?? "One per line."}>
			{(control) => (
				<textarea
					{...control}
					value={draft.value}
					rows={Math.max(3, Math.min(10, items.length + 1))}
					placeholder={placeholder}
					disabled={disabled}
					onFocus={draft.onFocus}
					onBlur={draft.onBlur}
					onChange={(e) => draft.onInput(e.target.value)}
				/>
			)}
		</Field>
	);
}

/** Two-column grid for short fields on wide screens; single column below 640 px. */
export function FieldRow({ children }: { children: ReactNode }) {
	return <div className="field-row">{children}</div>;
}

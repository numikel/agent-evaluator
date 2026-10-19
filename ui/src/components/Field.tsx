import { type ReactNode, useId } from "react";

/** Props the control inside a {@link Field} should spread so label, hint and error are wired up. */
export type FieldControlProps = {
	id: string;
	"aria-describedby": string | undefined;
	"aria-invalid": true | undefined;
};

export type FieldProps = {
	label: string;
	hint?: string;
	error?: string;
	/** Either static content or a render function receiving the aria wiring for the control. */
	children: ReactNode | ((control: FieldControlProps) => ReactNode);
};

export function Field({ label, hint, error, children }: FieldProps) {
	const id = useId();
	const hintId = hint ? `${id}-hint` : undefined;
	const errorId = error ? `${id}-error` : undefined;
	const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
	const control: FieldControlProps = {
		id,
		"aria-describedby": describedBy,
		"aria-invalid": error ? true : undefined,
	};
	return (
		<div className={`field${error ? " field--invalid" : ""}`}>
			<label className="field__label" htmlFor={id}>
				{label}
			</label>
			{typeof children === "function" ? children(control) : children}
			{hint ? (
				<span className="field__hint" id={hintId}>
					{hint}
				</span>
			) : null}
			{error ? (
				<span className="field__error" id={errorId} role="alert">
					{error}
				</span>
			) : null}
		</div>
	);
}

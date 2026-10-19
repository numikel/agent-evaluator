import type { ComponentPropsWithRef } from "react";

/** Native button props including `ref` (a plain prop in React 19). */
export type ButtonProps = ComponentPropsWithRef<"button"> & {
	variant?: "primary" | "secondary" | "danger" | "ghost";
	size?: "sm" | "md";
};

export function Button({
	variant = "secondary",
	size = "md",
	type = "button",
	className,
	...rest
}: ButtonProps) {
	const classes = ["btn", `btn--${variant}`, size === "sm" ? "btn--sm" : "", className ?? ""]
		.filter(Boolean)
		.join(" ");
	return <button type={type} className={classes} {...rest} />;
}

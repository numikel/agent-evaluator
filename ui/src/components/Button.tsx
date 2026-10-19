import type { ButtonHTMLAttributes } from "react";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
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

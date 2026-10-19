/**
 * List view for a resource collection: table of name / description / updated, delete with an
 * inline confirmation, "New from template" (asks for a slug, then opens the editor with the
 * template) and template download / upload.
 */
import type { ResourceKind, ResourceSummary } from "@schemas/api";
import { SLUG_PATTERN } from "@schemas/common";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { type Collection, endpoints } from "../api/client.js";
import { Button } from "../components/Button.js";
import { Field } from "../components/Field.js";
import { PageHeader } from "../components/PageHeader.js";
import { Panel } from "../components/Panel.js";
import { TemplateActions } from "../components/TemplateActions.js";
import { errorMessage, useAsync } from "../hooks/useAsync.js";

export type ResourceListPageProps = {
	collection: Collection;
	kind: ResourceKind;
	title: string;
	lead: string;
};

const formatDate = (iso: string | undefined): string => {
	if (!iso) return "—";
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

export function ResourceListPage({ collection, kind, title, lead }: ResourceListPageProps) {
	const navigate = useNavigate();
	const [version, setVersion] = useState(0);
	const list = useAsync(() => endpoints.list(collection), `${collection}#${version}`);
	const [removed, setRemoved] = useState<string[]>([]);
	const [pendingDelete, setPendingDelete] = useState<string | undefined>(undefined);
	const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");

	const reload = () => {
		setRemoved([]);
		setVersion((v) => v + 1);
	};

	const remove = async (name: string) => {
		setDeleteError(undefined);
		try {
			await endpoints.deleteResource(collection, name);
			setRemoved((r) => [...r, name]);
			setPendingDelete(undefined);
		} catch (error) {
			setDeleteError(`Could not delete ${name}: ${errorMessage(error)}`);
		}
	};

	const slugOk = SLUG_PATTERN.test(newName);
	const rows: ResourceSummary[] =
		list.status === "ready" ? list.data.filter((r) => !removed.includes(r.name)) : [];
	const existing = new Set(rows.map((r) => r.name));
	const duplicate = existing.has(newName);
	const singular = kind;

	return (
		<>
			<PageHeader
				title={title}
				lead={lead}
				actions={
					<>
						<TemplateActions
							kind={kind}
							collection={collection}
							onUploaded={(name) => {
								reload();
								void navigate(`/${collection}/${encodeURIComponent(name)}`);
							}}
						/>
						<Button variant="primary" onClick={() => setCreating(true)} aria-expanded={creating}>
							New from template
						</Button>
					</>
				}
			/>
			{creating ? (
				<Panel title={`New ${singular}`} className="panel--form">
					<form
						className="inline-form"
						onSubmit={(e) => {
							e.preventDefault();
							if (slugOk && !duplicate) {
								void navigate(`/${collection}/${encodeURIComponent(newName)}?new=1`);
							}
						}}
					>
						<Field
							label="Name"
							hint="Lowercase letters, digits and hyphens; becomes the file name."
							error={
								newName !== "" && !slugOk
									? "Must be a kebab-case slug."
									: duplicate
										? "A resource with this name already exists."
										: undefined
							}
						>
							{(control) => (
								<input
									{...control}
									type="text"
									className="mono"
									value={newName}
									autoComplete="off"
									placeholder={`my-${singular}`}
									onChange={(e) => setNewName(e.target.value.trim())}
								/>
							)}
						</Field>
						<div className="inline-form__actions">
							<Button type="submit" variant="primary" disabled={!slugOk || duplicate}>
								Create
							</Button>
							<Button onClick={() => setCreating(false)}>Cancel</Button>
						</div>
					</form>
				</Panel>
			) : null}
			<Panel title={`${rows.length} ${rows.length === 1 ? singular : collection}`}>
				{list.status === "error" ? (
					<p className="inline-error" role="alert">
						Could not load {collection}: {list.message}
					</p>
				) : list.status === "loading" ? (
					<p className="muted">Loading…</p>
				) : rows.length === 0 ? (
					<p className="muted">No {collection} yet. Start from the template or upload a file.</p>
				) : (
					<div className="table-wrap">
						<table className="table">
							<thead>
								<tr>
									<th scope="col">Name</th>
									<th scope="col">Description</th>
									<th scope="col">Updated</th>
									<th scope="col">
										<span className="visually-hidden">Actions</span>
									</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((row) => (
									<tr key={row.name}>
										<th scope="row">
											<Link className="mono" to={`/${collection}/${encodeURIComponent(row.name)}`}>
												{row.name}
											</Link>
										</th>
										<td className="table__desc">
											{row.description ?? <span className="muted">—</span>}
										</td>
										<td className="table__time">
											<time dateTime={row.updated_at}>{formatDate(row.updated_at)}</time>
										</td>
										<td className="table__actions">
											{pendingDelete === row.name ? (
												<span className="confirm">
													<span>Delete {row.name}?</span>
													<Button
														size="sm"
														variant="danger"
														aria-label={`Confirm deleting ${row.name}`}
														onClick={() => void remove(row.name)}
													>
														Confirm
													</Button>
													<Button
														size="sm"
														aria-label={`Cancel deleting ${row.name}`}
														onClick={() => setPendingDelete(undefined)}
													>
														Cancel
													</Button>
												</span>
											) : (
												<Button
													size="sm"
													variant="ghost"
													aria-label={`Delete ${row.name}`}
													onClick={() => setPendingDelete(row.name)}
												>
													Delete
												</Button>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				{deleteError ? (
					<p className="inline-error" role="alert">
						{deleteError}
					</p>
				) : null}
			</Panel>
		</>
	);
}

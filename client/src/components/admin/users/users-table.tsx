import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, CreditCard, ArrowUpDown, ArrowUp, ArrowDown, Star, StarOff, Shield, ShieldOff, Eye } from "lucide-react";
import { formatCost } from "@/lib/admin/utils";
import type { AdminUser, SortField, SortDir } from "@/lib/admin/types";
import { UserDetailsDialog } from "./user-details-dialog";

interface UsersTableProps {
    users: AdminUser[];
    currentUserId?: string;
    sortField: SortField;
    sortDir: SortDir;
    toggleSort: (field: SortField) => void;
    onToggleAffiliate: (id: string, is_affiliate: boolean) => void;
    onToggleAdmin: (id: string, is_admin: boolean) => void;
    isMutating: boolean;
}

export function UsersTable({
    users,
    currentUserId,
    sortField,
    sortDir,
    toggleSort,
    onToggleAffiliate,
    onToggleAdmin,
    isMutating
}: UsersTableProps) {
    const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);

    if (users.length === 0) {
        return (
            <div className="text-center py-12 text-sm text-muted-foreground border rounded-lg border-dashed">
                No users found
            </div>
        );
    }

    const renderSortIcon = (field: SortField) => {
        if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
        return sortDir === "desc" ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />;
    };

    return (
        <>
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead>User</TableHead>
                            <TableHead>Plan & Balance</TableHead>
                            <TableHead className="text-center">Posts</TableHead>
                            <TableHead className="text-right">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2 flex items-center gap-1 ml-auto hover:bg-transparent hover:text-foreground font-medium"
                                    onClick={() => toggleSort("usage")}
                                    data-testid="sort-usage"
                                >
                                    Usage
                                    {renderSortIcon("usage")}
                                </Button>
                            </TableHead>
                            <TableHead className="text-right">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2 flex items-center gap-1 ml-auto hover:bg-transparent hover:text-foreground font-medium"
                                    onClick={() => toggleSort("cost")}
                                    data-testid="sort-cost"
                                >
                                    Cost
                                    {renderSortIcon("cost")}
                                </Button>
                            </TableHead>
                            <TableHead>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2 flex items-center gap-1 hover:bg-transparent hover:text-foreground font-medium -ml-2"
                                    onClick={() => toggleSort("joined")}
                                    data-testid="sort-joined"
                                >
                                    Joined
                                    {renderSortIcon("joined")}
                                </Button>
                            </TableHead>
                            <TableHead className="w-[180px]">Role / Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {users.map((u) => (
                            <TableRow
                                key={u.id}
                                data-testid={`row-user-${u.id}`}
                            >
                                <TableCell>
                                    <div className="flex flex-col max-w-[200px]">
                                        <span className="font-medium truncate" title={u.email}>{u.email}</span>
                                        <span className="text-xs text-muted-foreground truncate" title={u.brand_name || "No brand"}>
                                            {u.brand_name || "—"}
                                        </span>
                                        {u.id === currentUserId && (
                                            <Badge variant="outline" className="w-fit mt-1 text-[10px] py-0 px-1 border-primary/20 text-primary">You</Badge>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-col gap-1 items-start">
                                        <span className={`flex items-center gap-1 text-xs font-medium whitespace-nowrap ${u.plan_name === "Credits" ? "text-green-500" : "text-muted-foreground"}`}>
                                            <CreditCard className="w-3 h-3" /> {u.plan_name || "Free"}
                                        </span>
                                        <span className="text-xs whitespace-nowrap font-mono text-muted-foreground">
                                            ${(u.balance_micros / 1_000_000).toFixed(2)} bal
                                        </span>
                                        {u.free_generations_remaining > 0 && (
                                            <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{u.free_generations_remaining} free</Badge>
                                        )}
                                        {u.referred_by_affiliate_id && (
                                            <span className="text-[10px] text-muted-foreground italic">Referred</span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="text-center">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 gap-1.5 text-xs font-mono w-full"
                                        onClick={() => setSelectedUser(u)}
                                        title="View User Posts"
                                    >
                                        <Eye className="w-3.5 h-3.5" />
                                        {u.post_count}
                                    </Button>
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex flex-col items-end text-xs whitespace-nowrap">
                                        <div><span className="font-mono font-medium">{u.generate_count}</span> <span className="text-muted-foreground text-[10px]">img</span></div>
                                        <div><span className="font-mono">{u.edit_count}</span> <span className="text-muted-foreground text-[10px]">edits</span></div>
                                    </div>
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs whitespace-nowrap">
                                    {formatCost(u.total_cost_usd_micros)}
                                </TableCell>
                                <TableCell>
                                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs whitespace-nowrap">
                                        <Calendar className="w-3.5 h-3.5" />
                                        {new Date(u.created_at).toLocaleDateString()}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-col gap-2">
                                        <div className="flex flex-wrap gap-1.5">
                                            {u.is_affiliate && (
                                                <Badge className="text-[10px] gap-1 px-1.5 py-0 bg-amber-500/15 text-amber-500 border-amber-500/30 hover:bg-amber-500/20">
                                                    <Star className="w-2.5 h-2.5" /> Afiliado
                                                </Badge>
                                            )}
                                            {u.is_admin ? (
                                                <Badge className="text-[10px] gap-1 px-1.5 py-0">
                                                    <Shield className="w-2.5 h-2.5" /> Admin
                                                </Badge>
                                            ) : !u.is_affiliate ? (
                                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">User</Badge>
                                            ) : null}
                                        </div>

                                        {u.id !== currentUserId && (
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className={`h-7 px-2 text-xs flex-1 ${u.is_affiliate ? "bg-amber-500/10 text-amber-500 border-amber-500/20 hover:bg-amber-500/20" : ""}`}
                                                    disabled={isMutating}
                                                    onClick={() => onToggleAffiliate(u.id, !u.is_affiliate)}
                                                    title={u.is_affiliate ? "Remove affiliate status" : "Make affiliate"}
                                                    data-testid={`button-toggle-affiliate-${u.id}`}
                                                >
                                                    {u.is_affiliate ? <StarOff className="w-3.5 h-3.5 mr-1" /> : <Star className="w-3.5 h-3.5 mr-1" />}
                                                    Affiliate
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className={`h-7 px-2 text-xs flex-1 ${u.is_admin ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20" : ""}`}
                                                    disabled={isMutating}
                                                    onClick={() => onToggleAdmin(u.id, !u.is_admin)}
                                                    title={u.is_admin ? "Remove admin status" : "Make admin"}
                                                    data-testid={`button-toggle-admin-${u.id}`}
                                                >
                                                    {u.is_admin ? <ShieldOff className="w-3.5 h-3.5 mr-1" /> : <Shield className="w-3.5 h-3.5 mr-1" />}
                                                    Admin
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            <UserDetailsDialog
                user={selectedUser}
                open={!!selectedUser}
                onOpenChange={(open) => !open && setSelectedUser(null)}
            />
        </>
    );
}

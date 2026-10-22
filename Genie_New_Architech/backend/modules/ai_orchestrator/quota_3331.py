from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class QuotaLease:
    user_allocations: tuple[int, int, int]
    reserve_allocation: int
    vip_priority: bool


def allocate_3331_quota(total: int, active_users: int, vip_priority: bool = False) -> QuotaLease:
    if total < 0 or active_users < 1:
        raise ValueError("A non-negative quota and at least one active user are required.")
    reserve = total // 10
    distributable = total - reserve
    base, remainder = divmod(distributable, 3)
    shares = [base + (1 if index < remainder else 0) for index in range(3)]
    if active_users > 3:
        shares[2] += sum(shares[3:])
        del shares[3:]
    allocations = tuple(shares[:active_users] + [0] * max(0, 3 - active_users))
    return QuotaLease(allocations, reserve, vip_priority)


def may_transfer_idle_lease(idle_seconds: int) -> bool:
    return idle_seconds >= 180

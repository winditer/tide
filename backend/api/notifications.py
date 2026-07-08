from fastapi import APIRouter, Depends, Query

from backend.core.dependencies import get_current_user
from backend.services.notification_service import notification_service

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(20),
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    items = await notification_service.get_notifications(
        user_id, limit=limit, unread_only=unread_only
    )
    return {"items": items}


@router.get("/count")
async def get_unread_count(current_user=Depends(get_current_user)):
    count = await notification_service.get_unread_count(current_user["id"])
    return {"count": count}


@router.post("/{notification_id}/read")
async def mark_read(notification_id: str, current_user=Depends(get_current_user)):
    await notification_service.mark_as_read(notification_id, current_user["id"])
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(current_user=Depends(get_current_user)):
    await notification_service.mark_all_as_read(current_user["id"])
    return {"ok": True}

"""Link an existing Supabase Auth identity as a tenant owner."""
import argparse
from uuid import UUID

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.admin import User
from app.models.models import Location


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--email',required=True)
    parser.add_argument('--name',default='Owner')
    parser.add_argument('--business-id',required=True)
    parser.add_argument('--location-id',required=True)
    parser.add_argument('--supabase-user-id',required=True)
    args=parser.parse_args()
    try:
        supabase_user_id=str(UUID(args.supabase_user_id))
    except ValueError as error:
        raise SystemExit('--supabase-user-id must be a valid Supabase Auth UUID') from error
    with SessionLocal.begin() as db:
        location=db.get(Location,args.location_id)
        if not location or location.business_id!=args.business_id:raise SystemExit('Unknown business/location')
        if db.scalar(select(User).where(User.email==args.email.strip().lower())):raise SystemExit('Account already exists')
        if db.scalar(select(User).where(User.supabase_user_id==supabase_user_id)):raise SystemExit('Supabase identity is already linked')
        db.add(User(name=args.name,email=args.email.strip().lower(),business_id=args.business_id,location_id=args.location_id,supabase_user_id=supabase_user_id,password_hash=None,role='ADMIN'))
    print('Owner account linked:',args.email)


if __name__=='__main__':main()

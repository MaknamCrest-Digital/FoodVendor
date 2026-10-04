"""Set the test database before importing any application module.

All endpoint tests override get_db with their own in-memory session factory.
Never allow collection/import order to select the development database.
"""
import os

os.environ['DATABASE_URL']='sqlite://'
os.environ['ENVIRONMENT']='test'

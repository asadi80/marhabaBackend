module.exports = {
  USER_ROLES: {
    USER: 'user',
    HOST: 'host',
    ADMIN: 'admin',
    SUPER_ADMIN: 'super_admin',
  },
  
  USER_STATUS: {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    ACTIVE: 'active',
    SUSPENDED: 'suspended',
    BANNED: 'banned',
  },
  
  BOOKING_STATUS: {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    CHECKED_IN: 'checked_in',
    CHECKED_OUT: 'checked_out',
    CANCELLED: 'cancelled',
    NO_SHOW: 'no_show',
  },
  
  PAYMENT_STATUS: {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    REFUNDED: 'refunded',
  },
  
  PAYMENT_TYPE: {
    SADAD: 'sadad',
    CASH: 'cash',
    ONLINE: 'online',
  },
  
  LISTING_STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    PENDING: 'pending',
    SUSPENDED: 'suspended',
  },
  
  LISTING_CATEGORY: {
    CITY: 'city',
    MOUNTAIN: 'mountain',
    BEACH: 'beach',
    COUNTRYSIDE: 'countryside',
  },
  
  CANCELLATION_POLICY: {
    FLEXIBLE: 'flexible',
    MODERATE: 'moderate',
    STRICT: 'strict',
  },
  
  HOST_VERIFICATION: {
    ONE_WEEK: 'oneWeek',
    TWO_DAYS: 'twoDays',
  },
};
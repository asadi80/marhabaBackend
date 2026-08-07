const { prisma } = require('../config/database');
const { PAYMENT_STATUS } = require('../utils/constants');

class PaymentModel {
  /**
   * Create a new payment
   */
  static async create(data) {
    return prisma.bookingPayment.create({
      data: {
        booking_id: data.booking_id,
        payment_method_id: data.payment_method_id || null,
        type: data.type || 'sadad',
        amount: parseFloat(data.amount),
        status: data.status || 'pending',
        sadad_reference: data.sadad_reference || null,
        sadad_transaction_id: data.sadad_transaction_id || null,
        notes: data.notes || null,
      },
      include: {
        booking: {
          include: {
            listing: {
              select: {
                id: true,
                title: true,
                location: true,
              },
            },
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        payment_method: true,
      },
    });
  }

  /**
   * Find payment by ID
   */
  static async findById(id, include = {}) {
    return prisma.bookingPayment.findUnique({
      where: { id },
      include: {
        booking: {
          include: {
            listing: {
              select: {
                id: true,
                title: true,
                location: true,
                price: true,
              },
            },
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone_number: true,
              },
            },
          },
        },
        payment_method: {
          select: {
            id: true,
            type: true,
            sadad_number: true,
            sadad_account_name: true,
            instructions: true,
          },
        },
        ...include,
      },
    });
  }

  /**
   * Find payments by booking ID
   */
  static async findByBooking(bookingId, options = {}) {
    const { page = 1, limit = 10, status } = options;
    const skip = (page - 1) * limit;

    const where = { booking_id: bookingId };
    if (status) {
      where.status = status;
    }

    const [payments, total] = await Promise.all([
      prisma.bookingPayment.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
        include: {
          payment_method: {
            select: {
              id: true,
              type: true,
              sadad_number: true,
              sadad_account_name: true,
            },
          },
        },
      }),
      prisma.bookingPayment.count({ where }),
    ]);

    return {
      data: payments,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Find payments by user (through bookings)
   */
  static async findByUser(userId, options = {}) {
    const { page = 1, limit = 10, status } = options;
    const skip = (page - 1) * limit;

    const where = {
      booking: {
        user_id: userId,
      },
      ...(status && { status }),
    };

    const [payments, total] = await Promise.all([
      prisma.bookingPayment.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
        include: {
          booking: {
            include: {
              listing: {
                select: {
                  id: true,
                  title: true,
                  location: true,
                },
              },
            },
          },
          payment_method: {
            select: {
              id: true,
              type: true,
              sadad_number: true,
              sadad_account_name: true,
            },
          },
        },
      }),
      prisma.bookingPayment.count({ where }),
    ]);

    return {
      data: payments,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Update payment status
   */
  static async updateStatus(id, status, extraData = {}) {
    const updateData = {
      status,
      ...extraData,
    };

    if (status === 'completed') {
      updateData.paid_at = new Date();
    }

    return prisma.bookingPayment.update({
      where: { id },
      data: updateData,
      include: {
        booking: {
          include: {
            listing: {
              select: {
                id: true,
                title: true,
                location: true,
              },
            },
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        payment_method: true,
      },
    });
  }

  /**
   * Process Sadad payment
   */
  static async processSadadPayment(id, sadadReference, sadadTransactionId) {
    return this.updateStatus(id, 'processing', {
      sadad_reference: sadadReference,
      sadad_transaction_id: sadadTransactionId,
    });
  }

  /**
   * Confirm Sadad payment
   */
  static async confirmSadadPayment(id, transactionData = {}) {
    const payment = await this.updateStatus(id, 'completed', {
      sadad_transaction_id: transactionData.transactionId || null,
      notes: transactionData.notes || null,
    });

    // Update booking status to confirmed if payment completed
    if (payment.booking && payment.booking.status === 'pending') {
      await prisma.booking.update({
        where: { id: payment.booking_id },
        data: { status: 'confirmed' },
      });
    }

    return payment;
  }

  /**
   * Fail payment
   */
  static async failPayment(id, reason) {
    return this.updateStatus(id, 'failed', {
      notes: reason,
    });
  }

  /**
   * Refund payment
   */
  static async refundPayment(id, reason) {
    return this.updateStatus(id, 'refunded', {
      notes: `Refunded: ${reason}`,
    });
  }

  /**
   * Get payment statistics
   */
  static async getStats(userId, role = 'user') {
    const where = role === 'host'
      ? {
          booking: {
            listing: {
              host_id: userId,
            },
          },
        }
      : {
          booking: {
            user_id: userId,
          },
        };

    const [totalPayments, completedPayments, totalAmount, pendingAmount] = await Promise.all([
      prisma.bookingPayment.count({ where }),
      prisma.bookingPayment.count({
        where: {
          ...where,
          status: 'completed',
        },
      }),
      prisma.bookingPayment.aggregate({
        where: {
          ...where,
          status: 'completed',
        },
        _sum: { amount: true },
      }),
      prisma.bookingPayment.aggregate({
        where: {
          ...where,
          status: 'pending',
        },
        _sum: { amount: true },
      }),
    ]);

    // Get monthly payments
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyPayments = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        SUM(amount) as total_amount,
        COUNT(*) as payment_count
      FROM booking_payments
      WHERE booking_id IN (
        SELECT id FROM bookings WHERE user_id = ${userId}
      )
      AND status = 'completed'
      AND created_at >= ${sixMonthsAgo}
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month DESC
    `;

    return {
      total_payments: totalPayments,
      completed_payments: completedPayments,
      total_amount: totalAmount._sum.amount || 0,
      pending_amount: pendingAmount._sum.amount || 0,
      monthly_payments: monthlyPayments,
    };
  }

  /**
   * Get payment method for host
   */
  static async getHostPaymentMethods(hostId, activeOnly = true) {
    const where = {
      host_id: hostId,
      ...(activeOnly && { is_active: true }),
    };

    return prisma.hostPaymentMethod.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Create host payment method
   */
  static async createHostPaymentMethod(data) {
    return prisma.hostPaymentMethod.create({
      data: {
        host_id: data.host_id,
        type: data.type || 'sadad',
        sadad_number: data.sadad_number,
        sadad_account_name: data.sadad_account_name,
        instructions: data.instructions || null,
        is_active: data.is_active !== undefined ? data.is_active : true,
      },
    });
  }

  /**
   * Update host payment method
   */
  static async updateHostPaymentMethod(id, data) {
    return prisma.hostPaymentMethod.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete host payment method
   */
  static async deleteHostPaymentMethod(id) {
    return prisma.hostPaymentMethod.update({
      where: { id },
      data: { is_active: false },
    });
  }

  /**
   * Check if host has active payment method
   */
  static async hasActivePaymentMethod(hostId) {
    const count = await prisma.hostPaymentMethod.count({
      where: {
        host_id: hostId,
        is_active: true,
      },
    });
    return count > 0;
  }
}

module.exports = PaymentModel;